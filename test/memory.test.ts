import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keywordsOf, recall, remember, threadTurns, type Db } from '../src/memory.ts'
import { openSqlite } from '../src/sqlite.ts'

const NOW = new Date('2026-11-12T04:30:00Z') // Thu 12 Nov 2026, 10:00 IST
const IST = 330
const at = (iso: string) => new Date(iso).getTime()

async function seeded(): Promise<Db> {
  const db = openSqlite(':memory:')
  const save = (userId: string, askedAt: number, question: string, answer: string) =>
    remember(db, userId, { threadId: 't1', askedAt, question, answer, sources: [{ title: 'Neon', url: 'https://neon.tech' }] })
  await save('u1', at('2026-11-03T09:00:00Z'), 'Compare managed Postgres hosting prices', 'Neon Launch is $19/mo.')
  await save('u1', at('2026-11-09T06:00:00Z'), 'Shortlist 5 CRM tools for a 20-person team', 'HubSpot, Pipedrive, Zoho...')
  await save('u2', at('2026-11-03T09:30:00Z'), 'Postgres on Supabase?', 'Someone else entirely.')
  return db
}

test('recalls what was asked in the window the user named', async () => {
  const r = await recall(await seeded(), 'u1', 'What did I ask you on 3 November?', NOW, IST)
  assert.equal(r.windows.length, 1)
  assert.deepEqual(r.windows[0].turns.map((t) => t.question), ['Compare managed Postgres hosting prices'])
  assert.deepEqual(r.windows[0].turns[0].sources, [{ title: 'Neon', url: 'https://neon.tech' }])
})

test('an ambiguous weekday returns both candidates and memory shows which is real', async () => {
  const r = await recall(await seeded(), 'u1', 'Last Tuesday I asked you about Postgres hosting', NOW, IST)
  assert.deepEqual(r.windows.map((w) => [w.label, w.turns.length]), [['Tue 10 Nov 2026', 0], ['Tue 3 Nov 2026', 1]])
})

test('an empty window is reported as empty, never filled from elsewhere', async () => {
  const r = await recall(await seeded(), 'u1', 'what did I ask yesterday', NOW, IST)
  assert.deepEqual(r.windows.map((w) => w.turns), [[]])
})

test('when the named day has a hit, other dates are kept out of the way', async () => {
  const r = await recall(await seeded(), 'u1', 'On Monday we shortlisted CRM tools. Any pricing changes?', NOW, IST)
  assert.deepEqual(r.windows[0].turns.map((t) => t.question), ['Shortlist 5 CRM tools for a 20-person team'])
  assert.deepEqual(r.related, [], 'the Postgres pricing exchange from 3 Nov is not offered')
})

test('wrong day, right topic: keyword recall still finds the exchange', async () => {
  const r = await recall(await seeded(), 'u1', 'Yesterday I asked about Postgres pricing', NOW, IST)
  assert.deepEqual(r.related.map((t) => t.question), ['Compare managed Postgres hosting prices'])
})

test('stemming matches pricing to prices, and memory never crosses users', async () => {
  const r = await recall(await seeded(), 'u1', 'postgres pricing', NOW, IST)
  assert.deepEqual(r.related.map((t) => t.answer), ['Neon Launch is $19/mo.'])
})

test('timeline is newest first; thread history is oldest first', async () => {
  const db = await seeded()
  const r = await recall(db, 'u1', 'hello', NOW, IST)
  assert.deepEqual(r.timeline.map((t) => t.question.slice(0, 9)), ['Shortlist', 'Compare m'])
  assert.deepEqual((await threadTurns(db, 'u1', 't1', 5)).map((t) => t.question.slice(0, 9)), ['Compare m', 'Shortlist'])
})

test('keywords drop filler and FTS syntax characters', () => {
  assert.deepEqual(keywordsOf('What did you say about "Postgres" pricing (AND more)?'), ['postgres', 'pricing'])
})
