// The HTTP API as one fetch-style handler: Request in, Response out.
// It knows nothing about Node or Cloudflare; node.ts and worker.ts each wrap it.
import { answer, type Ask, type Deps } from './agent.ts'
import { loadDemo } from './demo.ts'
import { createChat } from './llm.ts'
import { countTurnsSince, recentTurns, type Db } from './memory.ts'
import { createSearch } from './search.ts'

export type Env = Record<string, string | undefined>
export type App = (req: Request) => Promise<Response | undefined> // undefined = not an API route

const MAX_MESSAGE_CHARS = 2000
const MAX_BODY_BYTES = 16_384
const TIMELINE_TURNS = 100
const DAY = 86_400_000
const ID = /^[\w-]{8,64}$/

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
      baseUrl: env.LLM_BASE_URL || 'https://api.groq.com/openai/v1',
      model: env.LLM_MODEL || 'openai/gpt-oss-120b',
      reasoningEffort: env.LLM_REASONING_EFFORT || undefined,
    }),
  }
  const allowTimeTravel = env.ALLOW_TIME_TRAVEL === '1'
  const maxTurnsPerDay = Number(env.MAX_TURNS_PER_DAY) || Infinity // a spend cap for public deployments

  const guardSpend = async () => {
    if (maxTurnsPerDay === Infinity) return
    const used = await countTurnsSince(db, Date.now() - DAY)
    if (used >= maxTurnsPerDay) throw new HttpError(429, 'This demo has hit its daily limit. Run it locally with your own keys.')
  }

  return async (req) => {
    const { pathname, searchParams } = new URL(req.url)
    try {
      if (req.method === 'POST' && pathname === '/api/chat') {
        const body = await readJson(req)
        const ask = parseAsk(body)
        await guardSpend()
        // Time travel: replay a dated conversation by sending `now`. Off unless enabled.
        const at = allowTimeTravel && typeof body.now === 'string' ? new Date(body.now) : undefined
        if (at && Number.isNaN(at.getTime())) throw new HttpError(400, '`now` must be an ISO date-time.')
        return sse(answer(at ? { ...deps, now: () => at } : deps, ask))
      }
      if (req.method === 'POST' && pathname === '/api/demo') {
        const { userId, tz } = parseAsk({ ...(await readJson(req)), threadId: 'demo-thread', message: 'demo' })
        await guardSpend()
        return sse(loadDemo(deps, userId, tz))
      }
      if (req.method === 'GET' && pathname === '/api/turns') {
        const userId = searchParams.get('userId') ?? ''
        if (!ID.test(userId)) throw new HttpError(400, 'Invalid userId.')
        return Response.json(await recentTurns(db, userId, TIMELINE_TURNS))
      }
      return undefined
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status })
      console.error(err)
      return Response.json({ error: 'Something went wrong on the server.' }, { status: 500 })
    }
  }
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.')
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Body must be a JSON object.')
  return body as Record<string, unknown>
}

function parseAsk(body: Record<string, unknown>): Ask {
  const { userId, threadId, message, tz } = body
  if (typeof userId !== 'string' || !ID.test(userId)) throw new HttpError(400, 'Invalid userId.')
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
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}
