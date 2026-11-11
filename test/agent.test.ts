import assert from 'node:assert/strict'
import { test } from 'node:test'
import { answer, keepCited, type AgentEvent, type Deps } from '../src/agent.ts'
import type { Chat, Msg, ToolCall } from '../src/llm.ts'
import { recentTurns, remember } from '../src/memory.ts'
import { openSqlite } from '../src/sqlite.ts'

const NOW = new Date('2026-11-12T04:30:00Z') // Thu 12 Nov 2026, 10:00 IST
const ASK = { userId: 'u1', threadId: 't1', tz: 330 }

// A model that plays back scripted steps and records every prompt it was given.
function scriptedChat(steps: (string | ToolCall[])[]) {
  const prompts: { messages: Msg[]; hadTools: boolean }[] = []
  const chat: Chat = async function* (messages, tools) {
    prompts.push({ messages: structuredClone(messages), hadTools: !!tools })
    const step = steps.shift() ?? 'out of script'
    if (typeof step !== 'string') return step
    yield step
    return []
  }
  return { chat, prompts }
}

const searchCall = (id: string, query: string, since?: string): ToolCall => ({
  id,
  name: 'web_search',
  args: JSON.stringify({ query, since }),
})

async function run(deps: Deps, message: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const e of answer(deps, { ...ASK, message })) events.push(e)
  return events
}

test('searches of one round run in parallel and feed a cited answer that is remembered with its time', async () => {
  const db = openSqlite(':memory:')
  let running = 0
  let peak = 0
  const searched: [string, string | undefined][] = []
  const { chat, prompts } = scriptedChat([
    [searchCall('a', 'neon pricing 2026'), searchCall('b', 'supabase pricing 2026', '2026-11-03')],
    'Neon is $19/mo [1]. Supabase is $25/mo [2].',
  ])
  const deps: Deps = {
    db,
    chat,
    now: () => NOW,
    search: async (query, since) => {
      searched.push([query, since])
      peak = Math.max(peak, ++running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return [{ title: query, url: `https://example.com/${query.split(' ')[0]}`, snippet: 'price' }]
    },
  }

  const events = await run(deps, 'Compare Neon and Supabase pricing')

  assert.equal(peak, 2, 'both searches were in flight together')
  assert.deepEqual(searched, [
    ['neon pricing 2026', undefined],
    ['supabase pricing 2026', '2026-11-03'],
  ])
  assert.deepEqual(
    events.map((e) => e.type),
    ['memory', 'search', 'sources', 'text', 'done'],
  )
  assert.match(String(prompts[1].messages.at(-1)?.content), /\[2\] supabase pricing 2026/)

  const [saved] = await recentTurns(db, 'u1', 1)
  assert.equal(saved.askedAt, NOW.getTime())
  assert.equal(saved.answer, 'Neon is $19/mo [1]. Supabase is $25/mo [2].')
  assert.deepEqual(
    saved.sources.map((s) => s.url),
    ['https://example.com/neon', 'https://example.com/supabase'],
  )
})

test('what was asked on a date is put in front of the model with its real date, without a search', async () => {
  const db = openSqlite(':memory:')
  await remember(db, 'u1', {
    threadId: 'old',
    askedAt: new Date('2026-11-03T09:00:00Z').getTime(),
    question: 'Which Postgres host is cheapest?',
    answer: 'Neon Launch at $19/mo [1].',
    sources: [{ title: 'Neon pricing', url: 'https://neon.tech/pricing' }],
  })
  const { chat, prompts } = scriptedChat(['On Tue 3 Nov you asked which Postgres host is cheapest.'])
  const never = async () => assert.fail('no search expected')

  const events = await run({ db, chat, search: never, now: () => NOW }, 'What did I ask you on 3 November?')

  const system = String(prompts[0].messages[0].content)
  assert.match(system, /Now: Thu 12 Nov 2026, 10:00/)
  assert.match(system, /"on 3 November" could mean Tue 3 Nov 2026: 1 exchange/)
  assert.match(system, /\[Tue 3 Nov 2026 14:30\] User asked: Which Postgres host is cheapest\?/)
  assert.match(system, /You answered: Neon Launch at \$19\/mo\./, 'old citation markers are stripped')
  assert.match(system, /Source then \[1\]: Neon pricing https:\/\/neon\.tech\/pricing/)
  assert.deepEqual(events[0], {
    type: 'memory',
    windows: [{ phrase: 'on 3 November', label: 'Tue 3 Nov 2026', count: 1 }],
    related: 0,
  })
})

test('with no memory of that day the model is told so explicitly', async () => {
  const { chat, prompts } = scriptedChat(['I have no record of 3 November.'])
  const deps = { db: openSqlite(':memory:'), chat, search: async () => [], now: () => NOW }
  await run(deps, 'What did I ask you on 3 November?')
  const system = String(prompts[0].messages[0].content)
  assert.match(system, /Empty\. This user has no earlier exchanges/)
  assert.match(system, /could mean Tue 3 Nov 2026: no exchanges recorded/)
})

test('after the search budget is spent the model must answer without tools', async () => {
  const { chat, prompts } = scriptedChat([[searchCall('a', 'q1')], [searchCall('b', 'q2')], 'Final answer.'])
  const deps = { db: openSqlite(':memory:'), chat, search: async () => [], now: () => NOW }
  const events = await run(deps, 'dig deep')
  assert.deepEqual(
    prompts.map((p) => p.hadTools),
    [true, true, false],
  )
  assert.equal(events.at(-1)?.type, 'done')
})

test('a failed search is reported to the model instead of failing the turn', async () => {
  const { chat, prompts } = scriptedChat([[searchCall('a', 'q1')], 'Search is down, so I cannot verify that.'])
  const search = async () => {
    throw new Error('search failed (500)')
  }
  const events = await run({ db: openSqlite(':memory:'), chat, search, now: () => NOW }, 'latest news?')
  assert.match(String(prompts[1].messages.at(-1)?.content), /Search failed: search failed \(500\)/)
  assert.equal(events.at(-1)?.type, 'done')
})

test('a model error surfaces as an error event and nothing is remembered', async () => {
  const db = openSqlite(':memory:')
  const chat: Chat = async function* () {
    throw new Error('Model request failed (401)')
  }
  const events = await run({ db, chat, search: async () => [], now: () => NOW }, 'hi')
  assert.deepEqual(events.at(-1), { type: 'error', message: 'Model request failed (401)' })
  assert.equal((await recentTurns(db, 'u1', 5)).length, 0)
})

test('stored answers keep only real citations, renumbered from 1', () => {
  const sources = ['a', 'b', 'c'].map((x) => ({ title: x, url: `https://${x}.com` }))
  assert.deepEqual(keepCited('X [3]. Y [1][3]. Z [9].', sources), {
    answer: 'X [1]. Y [2][1]. Z .',
    sources: [sources[2], sources[0]],
  })
})
