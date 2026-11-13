import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Chat } from '../src/llm.ts'
import { remember } from '../src/memory.ts'
import { openSqlite } from '../src/sqlite.ts'
import { suggestions } from '../src/suggest.ts'

const AT = Date.UTC(2026, 10, 3, 6, 0)
const replying = (text: string) => { let calls = 0; const chat: Chat = async function* () { calls++; yield text; return [] }; return { chat, calls: () => calls } }

test('returning-user cards are written once per chat by the model, then served from the cache', async () => {
  const db = openSqlite(':memory:')
  await remember(db, 'u1', { threadId: 'thread-mac', askedAt: AT, question: 'Best MacBook Air M3 deals right now?', answer: 'a', sources: [] })
  const model = replying('Sure: {"items":[{"id":"thread-mac","topic":"MacBook Air Deals","followup":"Has any store cut the MacBook Air price since 3 Nov?"}]}')
  const first = await suggestions(db, model.chat, 'u1', 330)
  assert.deepEqual(first.map((s) => [s.threadId, s.topic, s.followup]), [['thread-mac', 'MacBook Air Deals', 'Has any store cut the MacBook Air price since 3 Nov?']])
  await suggestions(db, model.chat, 'u1', 330)
  assert.equal(model.calls(), 1, 'cached after the first call')
  assert.deepEqual(await suggestions(db, model.chat, 'someone-else', 330), [])
})

test('an unusable model reply falls back to a plain card instead of failing', async () => {
  const db = openSqlite(':memory:')
  await remember(db, 'u1', { threadId: 'thread-f1', askedAt: AT, question: 'Who won the Abu Dhabi Grand Prix?', answer: 'a', sources: [] })
  const [card] = await suggestions(db, replying('not json at all').chat, 'u1', 330)
  assert.equal(card.topic, 'Who won the Abu')
  assert.match(card.followup, /since I asked about this on 3 Nov\?$/)
})
