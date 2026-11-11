// The model client and the HTTP API, exercised against a local stand-in for the model endpoint.
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { createApp } from '../src/app.ts'
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
const post = (path: string, body: unknown) =>
  new Request(`http://app${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) })
const ask = { userId: 'user-0001', threadId: 'thread-0001', message: 'hello', tz: 330 }

async function events(res: Response): Promise<Record<string, unknown>[]> {
  return (await res.text())
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => JSON.parse(frame.slice('data: '.length)))
}

test('the app refuses to start without its keys and names them', () => {
  assert.throws(() => createApp(openSqlite(':memory:'), {}), /Missing LLM_API_KEY and FIRECRAWL_API_KEY/)
})

test('bad input is rejected with a reason', async () => {
  const app = createApp(openSqlite(':memory:'), env())
  const cases: [unknown, RegExp][] = [
    ['not json', /JSON object/],
    [{ ...ask, userId: 'x' }, /userId/],
    [{ ...ask, threadId: 'has spaces!' }, /threadId/],
    [{ ...ask, message: '   ' }, /empty/],
    [{ ...ask, message: 'x'.repeat(2001) }, /over 2000/],
    [{ ...ask, tz: 9999 }, /tz/],
  ]
  for (const [body, reason] of cases) {
    const res = await app(post('/api/chat', body))
    assert.equal(res?.status, 400)
    assert.match((await res!.json()).error, reason)
  }
  assert.equal((await app(new Request('http://app/api/turns?userId=x')))?.status, 400)
  assert.equal(await app(new Request('http://app/somewhere-else')), undefined)
})

test('a chat turn streams events, is remembered, and shows up in the timeline', async () => {
  script = [[{ content: 'Hi there.' }]]
  const app = createApp(openSqlite(':memory:'), env())
  const stream = await events((await app(post('/api/chat', ask)))!)
  assert.deepEqual(stream.map((e) => e.type), ['memory', 'text', 'done'])

  const turns = await (await app(new Request('http://app/api/turns?userId=user-0001')))!.json()
  assert.deepEqual(turns.map((t: { question: string; answer: string }) => [t.question, t.answer]), [['hello', 'Hi there.']])
})

test('a request can carry its own clock only when time travel is enabled', async () => {
  const then = '2026-11-03T10:00:00+05:30'
  const askedAt = async (extraEnv: object) => {
    script = [[{ content: 'ok' }]]
    const app = createApp(openSqlite(':memory:'), env(extraEnv))
    const stream = await events((await app(post('/api/chat', { ...ask, now: then })))!)
    return stream.at(-1)!.askedAt as number
  }
  assert.equal(await askedAt({ ALLOW_TIME_TRAVEL: '1' }), new Date(then).getTime())
  assert.ok(Math.abs((await askedAt({})) - Date.now()) < 5000, 'ignored when disabled')

  const app = createApp(openSqlite(':memory:'), env({ ALLOW_TIME_TRAVEL: '1' }))
  assert.equal((await app(post('/api/chat', { ...ask, now: 'yesterday-ish' })))?.status, 400)
})

test('the daily cap stops new turns once it is reached', async () => {
  script = [[{ content: 'first' }]]
  const app = createApp(openSqlite(':memory:'), env({ MAX_TURNS_PER_DAY: '1' }))
  await events((await app(post('/api/chat', ask)))!)
  const res = await app(post('/api/chat', ask))
  assert.equal(res?.status, 429)
  assert.match((await res!.json()).error, /daily limit/)
})
