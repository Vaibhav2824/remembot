// The model client and the HTTP API, exercised against a local stand-in for the model endpoint.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { createApp, type App } from '../src/app.ts'
import { createChat } from '../src/llm.ts'
import { openSqlite } from '../src/sqlite.ts'

// Each request pops the next scripted reply: an HTTP status, or a list of stream chunks.
let script: (number | object[])[] = []
let server: Server
let baseUrl = ''

before(async () => {
  server = createServer((req, res) => {
    req.resume()
    const reply = script.shift() ?? [{ content: 'ok' }]
    if (typeof reply === 'number') return res.writeHead(reply, { 'retry-after': '0' }).end('{"error":"slow down"}')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const delta of reply) res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`
})
after(() => server.close())

const chatClient = () => createChat({ baseUrl, apiKey: 'k', model: 'm' })

async function collect(stream: ReturnType<ReturnType<typeof createChat>>) {
  let text = ''
  let step = await stream.next()
  let waits = 0
  while (!step.done) {
    if (typeof step.value === 'string') text += step.value
    else waits++
    step = await stream.next()
  }
  return { text, calls: step.value, waits }
}

test('streamed text is yielded in order', async () => {
  script = [[{ content: 'Hel' }, { content: 'lo' }]]
  assert.deepEqual(await collect(chatClient()([{ role: 'user', content: 'hi' }])), { text: 'Hello', calls: [], waits: 0 })
})

test('tool calls that arrive in fragments are reassembled', async () => {
  script = [
    [
      { tool_calls: [{ index: 0, id: 'a', function: { name: 'web_search', arguments: '{"que' } }] },
      { tool_calls: [{ index: 1, id: 'b', function: { name: 'web_search', arguments: '{"query":"two"}' } }] },
      { tool_calls: [{ index: 0, function: { arguments: 'ry":"one"}' } }] },
    ],
  ]
  const { calls } = await collect(chatClient()([{ role: 'user', content: 'hi' }], [{}]))
  assert.deepEqual(calls, [
    { id: 'a', name: 'web_search', args: '{"query":"one"}' },
    { id: 'b', name: 'web_search', args: '{"query":"two"}' },
  ])
})

test('a rate-limited request waits as told and retries until it succeeds', async () => {
  script = [429, 429, [{ content: 'third try' }]]
  const { text, waits } = await collect(chatClient()([{ role: 'user', content: 'hi' }]))
  assert.deepEqual([text, waits], ['third try', 2])
})

test('a failing model endpoint throws with the status', async () => {
  script = [500]
  await assert.rejects(collect(chatClient()([{ role: 'user', content: 'hi' }])), /Model request failed \(500\)/)
})

// ---------- HTTP API ----------
const env = (extra = {}) => ({ LLM_API_KEY: 'k', FIRECRAWL_API_KEY: 'k', LLM_BASE_URL: baseUrl, ...extra })
const ask = { threadId: 'thread-0001', message: 'hello', tz: 330 }
const send = (app: App, method: string, path: string, body?: unknown, cookie = '', headers: Record<string, string> = {}) =>
  app(
    new Request(`http://app${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie, ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
  ) as Promise<Response>
const cookieOf = (res: Response) => res.headers.get('set-cookie')!.split(';')[0]
async function signup(app: App, email = 'ada@example.com', password = 'correct horse battery') {
  const res = await send(app, 'POST', '/api/auth/signup', { name: 'Ada', email, password })
  assert.equal(res.status, 201)
  return cookieOf(res)
}

async function events(res: Response): Promise<Record<string, unknown>[]> {
  return (await res.text())
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.slice('data: '.length)))
}

test('the app refuses to start without its keys and names them', () => {
  assert.throws(() => createApp(openSqlite(':memory:'), {}), /Missing LLM_API_KEY and FIRECRAWL_API_KEY/)
})

test('sign up, sign out and sign in again; the password is stored only as a salted hash', async () => {
  const db = openSqlite(':memory:')
  const app = createApp(db, env())
  const cookie = await signup(app)
  const me = await (await send(app, 'GET', '/api/auth/me', undefined, cookie)).json()
  assert.deepEqual([me.name, me.email], ['Ada', 'ada@example.com'])
  const [row] = await db.all<{ pass: string }>('SELECT pass FROM users')
  assert.match(row.pass, /^pbkdf2-sha256\$100000\$/)
  assert.ok(!row.pass.includes('correct horse'))

  assert.equal((await send(app, 'POST', '/api/auth/logout', {}, cookie)).status, 200)
  assert.equal((await send(app, 'GET', '/api/auth/me', undefined, cookie)).status, 401, 'the old cookie no longer works')

  assert.equal((await send(app, 'POST', '/api/auth/login', { email: 'ADA@example.com', password: 'nope nope' })).status, 401)
  const right = await send(app, 'POST', '/api/auth/login', { email: ' ADA@example.com ', password: 'correct horse battery' })
  assert.equal(right.status, 200)
  assert.match(right.headers.get('set-cookie')!, /HttpOnly; SameSite=Lax/)
  assert.equal((await send(app, 'GET', '/api/auth/me', undefined, cookieOf(right))).status, 200)
})

test('sign-up input is validated, duplicates and bots are refused', async () => {
  const app = createApp(openSqlite(':memory:'), env())
  const cases: [object, RegExp][] = [
    [{ name: 'A', email: 'not-an-email', password: 'long enough' }, /valid email/],
    [{ name: 'A', email: 'a@b.co', password: 'short' }, /at least 8/],
    [{ name: '  ', email: 'a@b.co', password: 'long enough' }, /name/],
    [{ name: 'A', email: 'a@b.co', password: 'long enough', website: 'http://spam' }, /Could not/],
  ]
  for (const [body, reason] of cases) {
    const res = await send(app, 'POST', '/api/auth/signup', body)
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, reason)
  }
  const fresh = createApp(openSqlite(':memory:'), env()) // the per-IP sign-up limit is 5 an hour
  await signup(fresh)
  assert.equal((await send(fresh, 'POST', '/api/auth/signup', { name: 'B', email: 'Ada@Example.com', password: 'another one' })).status, 409)
})

test('repeated wrong passwords lock the email for a while', async () => {
  const app = createApp(openSqlite(':memory:'), env())
  await signup(app)
  for (let i = 0; i < 10; i++) assert.equal((await send(app, 'POST', '/api/auth/login', { email: 'ada@example.com', password: `guess ${i}` })).status, 401)
  assert.equal((await send(app, 'POST', '/api/auth/login', { email: 'ada@example.com', password: 'correct horse battery' })).status, 429)
})

test('cross-site and non-JSON writes are refused; pages redirect by session', async () => {
  const app = createApp(openSqlite(':memory:'), env())
  const cookie = await signup(app)
  assert.equal((await send(app, 'POST', '/api/chat', ask, cookie, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await send(app, 'POST', '/api/chat', ask, cookie, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await send(app, 'POST', '/api/chat', ask)).status, 401)
  assert.equal((await send(app, 'GET', '/')).headers.get('location'), '/login')
  assert.equal(await send(app, 'GET', '/', undefined, cookie), undefined, 'signed in: the app page is served')
  assert.equal((await send(app, 'GET', '/login', undefined, cookie)).headers.get('location'), '/')
  assert.equal(await send(app, 'GET', '/privacy'), undefined)
})

test('bad chat input is rejected with a reason', async () => {
  const app = createApp(openSqlite(':memory:'), env())
  const cookie = await signup(app)
  const cases: [unknown, RegExp][] = [
    ['not json', /JSON object/],
    [{ ...ask, threadId: 'has spaces!' }, /threadId/],
    [{ ...ask, message: '   ' }, /empty/],
    [{ ...ask, message: 'x'.repeat(2001) }, /over 2000/],
    [{ ...ask, tz: 9999 }, /tz/],
  ]
  for (const [body, reason] of cases) {
    const res = await send(app, 'POST', '/api/chat', body, cookie)
    assert.equal(res.status, 400)
    assert.match((await res.json()).error, reason)
  }
  assert.equal((await send(app, 'GET', '/api/threads/x', undefined, cookie)).status, 400)
})

test('a chat is saved, listed, reopened and deleted, and only its owner can see it', async () => {
  script = [[{ content: 'Hi there.' }]]
  const app = createApp(openSqlite(':memory:'), env())
  const ada = await signup(app)
  const bob = await signup(app, 'bob@example.com')
  const stream = await events(await send(app, 'POST', '/api/chat', ask, ada))
  assert.deepEqual(stream.map((e) => e.type), ['memory', 'text', 'done'])

  const threads = await (await send(app, 'GET', '/api/threads', undefined, ada)).json()
  assert.deepEqual(threads.map((t: { id: string; title: string; count: number }) => [t.id, t.title, t.count]), [['thread-0001', 'hello', 1]])
  const turns = await (await send(app, 'GET', '/api/threads/thread-0001', undefined, ada)).json()
  assert.deepEqual(turns.map((t: { question: string; answer: string }) => [t.question, t.answer]), [['hello', 'Hi there.']])

  assert.deepEqual(await (await send(app, 'GET', '/api/threads', undefined, bob)).json(), [])
  assert.deepEqual(await (await send(app, 'GET', '/api/threads/thread-0001', undefined, bob)).json(), [])
  await send(app, 'DELETE', '/api/threads/thread-0001', {}, bob)
  assert.equal((await (await send(app, 'GET', '/api/threads', undefined, ada)).json()).length, 1, 'another user cannot delete it')

  await send(app, 'DELETE', '/api/threads/thread-0001', {}, ada)
  assert.deepEqual(await (await send(app, 'GET', '/api/threads', undefined, ada)).json(), [])
})

test('deleting the account needs the password and removes everything', async () => {
  script = [[{ content: 'ok' }]]
  const db = openSqlite(':memory:')
  const app = createApp(db, env())
  const cookie = await signup(app)
  await events(await send(app, 'POST', '/api/chat', ask, cookie))
  assert.equal((await send(app, 'DELETE', '/api/auth/me', { password: 'wrong' }, cookie)).status, 403)
  assert.equal((await send(app, 'DELETE', '/api/auth/me', { password: 'correct horse battery' }, cookie)).status, 200)
  for (const table of ['users', 'sessions', 'turns', 'turns_fts']) assert.deepEqual(await db.all(`SELECT * FROM ${table}`), [], table)
})

test('a request can carry its own clock only when time travel is enabled', async () => {
  const then = '2026-11-03T10:00:00+05:30'
  const askedAt = async (extraEnv: object) => {
    script = [[{ content: 'ok' }]]
    const app = createApp(openSqlite(':memory:'), env(extraEnv))
    const stream = await events(await send(app, 'POST', '/api/chat', { ...ask, now: then }, await signup(app)))
    return stream.at(-1)!.askedAt as number
  }
  assert.equal(await askedAt({ ALLOW_TIME_TRAVEL: '1' }), new Date(then).getTime())
  assert.ok(Math.abs((await askedAt({})) - Date.now()) < 5000, 'ignored when disabled')

  const app = createApp(openSqlite(':memory:'), env({ ALLOW_TIME_TRAVEL: '1' }))
  assert.equal((await send(app, 'POST', '/api/chat', { ...ask, now: 'yesterday-ish' }, await signup(app))).status, 400)
})

test('the daily caps stop new turns once they are reached', async () => {
  for (const [cap, reason] of [['MAX_TURNS_PER_DAY', /daily limit/], ['MAX_TURNS_PER_USER_PER_DAY', /1 questions today/]] as const) {
    script = [[{ content: 'first' }]]
    const app = createApp(openSqlite(':memory:'), env({ [cap]: '1' }))
    const cookie = await signup(app)
    await events(await send(app, 'POST', '/api/chat', ask, cookie))
    const res = await send(app, 'POST', '/api/chat', ask, cookie)
    assert.equal(res.status, 429)
    assert.match((await res.json()).error, reason)
  }
})

test('a burst of parallel questions cannot overrun the per-user cap', async () => {
  script = Array.from({ length: 6 }, () => [{ content: 'ok' }])
  const app = createApp(openSqlite(':memory:'), env({ MAX_TURNS_PER_USER_PER_DAY: '2' }))
  const cookie = await signup(app)
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => send(app, 'POST', '/api/chat', { ...ask, threadId: `thread-000${i}` }, cookie)))
  await Promise.all(burst.map((r) => r.text()))
  assert.deepEqual(burst.map((r) => r.status).sort(), [200, 200, 429, 429, 429, 429])
})
