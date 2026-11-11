import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveTime } from '../src/time.ts'

// Thu 12 Nov 2026, 10:00 in India (UTC+5:30)
const NOW = new Date('2026-11-12T04:30:00Z')
const IST = 330
const labels = (text: string) => resolveTime(text, NOW, IST).map((w) => w.label)

test('explicit date without a year resolves to its latest occurrence', () => {
  assert.deepEqual(labels('What did I ask you on 3 November?'), ['Tue 3 Nov 2026'])
  assert.deepEqual(labels('what did I ask on 20 December'), ['Sat 20 Dec 2025'])
})

test('bare weekday yields the latest one plus the week before as candidates', () => {
  assert.deepEqual(labels('Last Tuesday I asked you about Postgres hosting.'), ['Tue 10 Nov 2026', 'Tue 3 Nov 2026'])
  assert.deepEqual(labels('On Monday we shortlisted 5 CRM tools for a 20-person sales team.'), [
    'Mon 9 Nov 2026',
    'Mon 2 Nov 2026',
  ])
})

test('a weekday never resolves to the future', () => {
  assert.deepEqual(labels('anything new since Friday?'), ['Fri 6 Nov 2026', 'Fri 30 Oct 2026'])
})

test('relative days', () => {
  assert.deepEqual(labels('what did we talk about yesterday'), ['Wed 11 Nov 2026'])
  assert.deepEqual(labels('a couple of days ago you said'), ['Tue 10 Nov 2026'])
  assert.deepEqual(labels('this morning I asked'), ['Thu 12 Nov 2026'])
})

test('weeks and months become calendar ranges', () => {
  assert.deepEqual(labels('last week I asked about rust'), ['week of Mon 2 Nov 2026'])
  assert.deepEqual(labels('what did I ask last month'), ['Oct 2026'])
})

test('numeric dates keep both day-first and month-first readings', () => {
  assert.deepEqual(labels('what did I ask on 3/11'), ['Tue 3 Nov 2026', 'Wed 11 Mar 2026'])
})

test('"on the 3rd" means the latest 3rd', () => {
  assert.deepEqual(labels('what did I ask on the 3rd'), ['Tue 3 Nov 2026'])
  assert.deepEqual(labels('what did I ask on the 25th'), ['Sun 25 Oct 2026'])
})

test('windows are whole days in the user timezone, not UTC', () => {
  const [w] = resolveTime('on 3 November', NOW, IST)
  assert.equal(new Date(w.from).toISOString(), '2026-11-02T18:30:00.000Z')
  assert.equal(w.to - w.from, 86_400_000)
})

test('text with no day reference yields no windows', () => {
  for (const text of ['What is 2+2?', 'top 10 tools in 2026', 'call me at 5pm', 'may I ask something', 'hello']) {
    assert.deepEqual(labels(text), [], text)
  }
})
