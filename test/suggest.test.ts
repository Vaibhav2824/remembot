import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chat } from '../src/llm.ts'
import { remember } from '../src/memory.ts'
import { openSqlite } from '../src/sqlite.ts'
import { suggestions, when } from '../src/suggest.ts'

const AT = Date.UTC(2026, 10, 3, 6, 0) // Tue 3 Nov 2026, 11:30 IST
const replying = (text: string) => { let calls = 0; const chat: Chat = async function* () { calls++; yield text; return [] }; return { chat, calls: () => calls } }
const MODEL_REPLY = '{"items":[{"id":"thread-mac","topic":"MacBook Air Deals","followup":"Has any store cut the MacBook Air price since I asked {when}?"}]}'

test('the date in a card is filled at display time, so it never goes stale', async () => {
  const db = openSqlite(':memory:')
  await remember(db, 'u1', { threadId: 'thread-mac', askedAt: AT, question: 'Best MacBook Air M3 deals right now?', answer: 'a', sources: [] })
  const model = replying(MODEL_REPLY)
  const sameDay = await suggestions(db, model.chat, 'u1', 330, AT + 3_600_000)
  assert.deepEqual(sameDay.map((s) => [s.topic, s.followup]), [['MacBook Air Deals', 'Has any store cut the MacBook Air price since I asked earlier today?']])
  const later = await suggestions(db, model.chat, 'u1', 330, AT + 10 * 86_400_000)
  assert.equal(later[0].followup, 'Has any store cut the MacBook Air price since I asked on 3 Nov?')
  assert.equal(model.calls(), 1, 'written once, then cached')
  assert.deepEqual(await suggestions(db, model.chat, 'someone-else', 330), [])
})

test('a cached question with a frozen date, or a reply without {when}, is rewritten or replaced', async () => {
  const db = openSqlite(':memory:')
  await remember(db, 'u1', { threadId: 'thread-mac', askedAt: AT, question: 'Best MacBook Air M3 deals right now?', answer: 'a', sources: [] })
  await db.run("INSERT INTO thread_notes VALUES ('u1', 'thread-mac', 'Old', 'What changed since November 3?')")
  const model = replying(MODEL_REPLY)
  assert.match((await suggestions(db, model.chat, 'u1', 330, AT))[0].followup, /earlier today\?$/)
  assert.equal(model.calls(), 1)

  const db2 = openSqlite(':memory:')
  await remember(db2, 'u1', { threadId: 'thread-f1', askedAt: AT, question: 'Who won the Abu Dhabi Grand Prix?', answer: 'a', sources: [] })
  const [card] = await suggestions(db2, replying('{"items":[{"id":"thread-f1","topic":"F1","followup":"What changed since 3 Nov?"}]}').chat, 'u1', 330, AT + 86_400_000)
  assert.equal(card.followup, 'Has anything changed since I asked about this yesterday?')
})

test('"when" follows the user\'s calendar day, not UTC', () => {
  const lateNightIST = Date.UTC(2026, 10, 12, 19, 0) // Fri 13 Nov 00:30 IST, still 12 Nov in UTC
  assert.equal(when(lateNightIST, 330, Date.UTC(2026, 10, 13, 6, 0)), 'earlier today')
  assert.equal(when(lateNightIST, 0, Date.UTC(2026, 10, 13, 6, 0)), 'yesterday')
})
