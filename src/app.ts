// The HTTP API as one fetch-style handler: Request in, Response out.
// It knows nothing about Node or Cloudflare; node.ts and worker.ts each wrap it.
import { answer, type Ask, type Deps } from './agent.ts'
import { createSession, dummyHash, endSession, hashPassword, overLimit, sessionCookie, sessionUser, verifyPassword, type User } from './auth.ts'
import { loadDemo } from './demo.ts'
import { createChat } from './llm.ts'
import { forget, listThreads, threadTurns, type Db } from './memory.ts'
import { createSearch } from './search.ts'

export type Env = Record<string, string | undefined>
export type App = (req: Request) => Promise<Response | undefined> // undefined = not handled here: serve the static file

const MAX_MESSAGE_CHARS = 2000
const MAX_BODY_BYTES = 16_384
const MAX_THREADS = 200
const MAX_THREAD_TURNS = 200
const DAY = 86_400_000
const MINUTE = 60_000
const ID = /^[\w-]{8,64}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/

class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function createApp(db: Db, env: Env): App {
  const missing = ['LLM_API_KEY', 'FIRECRAWL_API_KEY'].filter((key) => !env[key])
  if (missing.length) throw new Error(`Missing ${missing.join(' and ')}. Copy .env.example to .env and fill them in.`)

  const deps: Deps = {
    db,
    now: () => new Date(),
    search: createSearch(env.FIRECRAWL_API_KEY!),
    chat: createChat({
      apiKey: env.LLM_API_KEY!,
      baseUrl: env.LLM_BASE_URL || 'https://api.openai.com/v1',
      model: env.LLM_MODEL || 'gpt-6-luna',
      reasoningEffort: env.LLM_REASONING_EFFORT ?? 'none', // gpt-6-luna calls tools on Chat Completions only at "none"
      serviceTier: env.LLM_SERVICE_TIER || undefined,
    }),
    preSearch: env.PRE_SEARCH !== '0',
  }
  const allowTimeTravel = env.ALLOW_TIME_TRAVEL === '1'
  // Spend caps for a public deployment: all users together, and each user.
  const maxTurnsPerDay = Number(env.MAX_TURNS_PER_DAY) || Infinity
  const maxTurnsPerUserPerDay = Number(env.MAX_TURNS_PER_USER_PER_DAY) || Infinity

  // Counted when a turn starts, not when it is saved: parallel requests cannot overrun the cap.
  const guardSpend = async (userId: string) => {
    if (maxTurnsPerUserPerDay !== Infinity && (await overLimit(db, `turn:${userId}`, maxTurnsPerUserPerDay, DAY)))
      throw new HttpError(429, `You have asked ${maxTurnsPerUserPerDay} questions today, the daily limit. Come back tomorrow.`)
    if (maxTurnsPerDay !== Infinity && (await overLimit(db, 'turn:all', maxTurnsPerDay, DAY)))
      throw new HttpError(429, 'Remembot has hit its daily limit. Please try again tomorrow.')
  }

  return async (req) => {
    const url = new URL(req.url)
    const { pathname } = url
    const secure = url.protocol === 'https:'
    try {
      // Pages: the app needs an account, the sign-in page does not need a second one.
      if (req.method === 'GET' && (pathname === '/' || pathname === '/login')) {
        const user = await sessionUser(db, req)
        if (pathname === '/' && !user) return redirect('/login')
        if (pathname === '/login' && user) return redirect('/')
        return undefined
      }
      if (!pathname.startsWith('/api/')) return undefined
      if (req.method !== 'GET') checkCsrf(req, url)
      const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'

      // ---------- accounts ----------
      if (req.method === 'POST' && pathname === '/api/auth/signup') {
        const body = await readJson(req)
        if (await overLimit(db, `signup:${ip}`, 5, 60 * MINUTE)) throw new HttpError(429, 'Too many sign-ups from this network. Try again in an hour.')
        if (body.website) throw new HttpError(400, 'Could not create the account.') // honeypot: only bots fill the hidden field
        const { email, password } = parseCredentials(body, true)
        const name = parseName(body.name)
        const [taken] = await db.all('SELECT 1 FROM users WHERE email = ?', email)
        if (taken) throw new HttpError(409, 'An account with this email already exists. Sign in instead.')
        const user: User = { id: crypto.randomUUID(), email, name }
        try {
          await db.run('INSERT INTO users (id, email, name, pass) VALUES (?, ?, ?, ?)', user.id, email, name, await hashPassword(password))
        } catch {
          throw new HttpError(409, 'An account with this email already exists. Sign in instead.') // lost a race to the same email
        }
        return signedIn(db, user, secure, 201)
      }
      if (req.method === 'POST' && pathname === '/api/auth/login') {
        const { email, password } = parseCredentials(await readJson(req), false)
        // Per email from one network (tight), per network, and per email from anywhere (loose,
        // so a stranger cannot lock the owner out with a few bad guesses).
        const limited = await Promise.all([
          overLimit(db, `login:${email}:${ip}`, 10, 15 * MINUTE),
          overLimit(db, `ip:${ip}`, 30, 15 * MINUTE),
          overLimit(db, `login:${email}`, 100, 15 * MINUTE),
        ])
        if (limited.some(Boolean)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes, then try again.')
        const [row] = await db.all<User & { pass: string }>('SELECT id, email, name, pass FROM users WHERE email = ?', email)
        const ok = await verifyPassword(password, row?.pass ?? (await dummyHash()))
        if (!row || !ok) throw new HttpError(401, 'That email and password do not match an account.')
        return signedIn(db, { id: row.id, email: row.email, name: row.name }, secure)
      }
      if (req.method === 'POST' && pathname === '/api/auth/logout') {
        await endSession(db, req)
        return json({ ok: true }, 200, sessionCookie(null, secure))
      }

      // ---------- everything below needs a session ----------
      const user = await sessionUser(db, req)
      if (!user) throw new HttpError(401, 'Sign in to continue.')

      if (req.method === 'GET' && pathname === '/api/auth/me') return json(user)
      if (req.method === 'DELETE' && pathname === '/api/auth/me') {
        const { password } = await readJson(req)
        if (await overLimit(db, `delete:${user.id}`, 5, 15 * MINUTE)) throw new HttpError(429, 'Too many attempts. Wait 15 minutes, then try again.')
        const [row] = await db.all<{ pass: string }>('SELECT pass FROM users WHERE id = ?', user.id)
        if (typeof password !== 'string' || !(await verifyPassword(password, row.pass))) throw new HttpError(403, 'That password is not right.')
        await forget(db, user.id)
        await db.run('DELETE FROM sessions WHERE user_id = ?', user.id)
        await db.run('DELETE FROM users WHERE id = ?', user.id)
        return json({ ok: true }, 200, sessionCookie(null, secure))
      }
      if (req.method === 'POST' && pathname === '/api/chat') {
        const body = await readJson(req)
        const ask = parseAsk(body, user.id)
        await guardSpend(user.id)
        // Time travel: replay a dated conversation by sending `now`. Off unless enabled.
        const at = allowTimeTravel && typeof body.now === 'string' ? new Date(body.now) : undefined
        if (at && Number.isNaN(at.getTime())) throw new HttpError(400, '`now` must be an ISO date-time.')
        return sse(answer(at ? { ...deps, now: () => at } : deps, ask))
      }
      if (req.method === 'POST' && pathname === '/api/demo') {
        const { tz } = parseAsk({ ...(await readJson(req)), threadId: 'demo-thread', message: 'demo' }, user.id)
        await guardSpend(user.id)
        return sse(loadDemo(deps, user.id, tz))
      }
      if (req.method === 'GET' && pathname === '/api/threads') return json(await listThreads(db, user.id, MAX_THREADS))
      const thread = pathname.match(/^\/api\/threads\/([^/]+)$/)?.[1]
      if (thread !== undefined) {
        if (!ID.test(thread)) throw new HttpError(400, 'Invalid chat id.')
        if (req.method === 'GET') return json(await threadTurns(db, user.id, thread, MAX_THREAD_TURNS))
        if (req.method === 'DELETE') {
          await forget(db, user.id, thread)
          return json({ ok: true })
        }
      }
      throw new HttpError(404, 'No such API route.')
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status)
      console.error(err)
      return json({ error: 'Something went wrong on the server.' }, 500)
    }
  }
}

// Browsers send Origin on cross-site POSTs and cannot send a JSON content type without
// a CORS preflight, which this API never grants. Either check alone stops CSRF.
function checkCsrf(req: Request, url: URL) {
  const origin = req.headers.get('origin')
  if (origin && origin !== url.origin) throw new HttpError(403, 'Cross-site request refused.')
  if (!req.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON.')
}

async function signedIn(db: Db, user: User, secure: boolean, status = 200): Promise<Response> {
  return json(user, status, sessionCookie(await createSession(db, user.id), secure))
}

const json = (body: unknown, status = 200, cookie?: string) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...(cookie && { 'set-cookie': cookie }) } })
const redirect = (location: string) => new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } })

async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.')
  const text = await req.text() // checked after reading too: a chunked body has no content-length
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.')
  let body: unknown = null
  try {
    body = JSON.parse(text)
  } catch {
    // not JSON: reported below
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object.')
  return body as Record<string, unknown>
}

function parseCredentials(body: Record<string, unknown>, isNew: boolean): { email: string; password: string } {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const { password } = body
  if (email.length > 254 || !EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address.')
  if (typeof password !== 'string' || !password) throw new HttpError(400, 'Enter your password.')
  if (password.length > 128) throw new HttpError(400, 'Passwords can be at most 128 characters.')
  if (isNew && password.length < 8) throw new HttpError(400, 'Use at least 8 characters for your password.')
  return { email, password }
}

function parseName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/[\p{C}]/gu, '').trim() : ''
  if (!name) throw new HttpError(400, 'Enter your name.')
  if (name.length > 60) throw new HttpError(400, 'Names can be at most 60 characters.')
  return name
}

function parseAsk(body: Record<string, unknown>, userId: string): Ask {
  const { threadId, message, tz } = body
  if (typeof threadId !== 'string' || !ID.test(threadId)) throw new HttpError(400, 'Invalid threadId.')
  if (typeof message !== 'string' || !message.trim()) throw new HttpError(400, 'Message is empty.')
  if (message.length > MAX_MESSAGE_CHARS) throw new HttpError(400, `Message is over ${MAX_MESSAGE_CHARS} characters.`)
  if (typeof tz !== 'number' || !Number.isInteger(tz) || Math.abs(tz) > 14 * 60) throw new HttpError(400, 'Invalid tz.')
  return { userId, threadId, message: message.trim(), tz }
}

// An async generator of events -> a server-sent-events response. Pull-based, so a
// client that disconnects stops the agent (and its model and search calls) too.
function sse(events: AsyncGenerator<unknown>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await events.next()
      if (done) controller.close()
      else controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`))
    },
    async cancel() {
      await events.return(undefined)
    },
  })
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } })
}

// Headers for every response, page or API, on both runtimes.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://icons.duckduckgo.com",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

export function withSecurityHeaders(res: Response, https: boolean): Response {
  const out = new Response(res.body, res) // a fetched response's headers are immutable
  out.headers.set('content-security-policy', CSP)
  out.headers.set('x-content-type-options', 'nosniff')
  out.headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  out.headers.set('x-frame-options', 'DENY')
  out.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()')
  if (https) out.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains')
  return out
}
