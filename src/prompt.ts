// What the model is told: fixed rules (SYSTEM) plus a context block rebuilt for
// every message from the clock and from memory.
import type { Recall, Source, Turn } from './memory.ts'
import { fmtDay, fmtTime } from './time.ts'

export const SYSTEM = `You are Asof, a chat agent with one tool, web_search, and a long-term memory of every past exchange with this user. Every remembered exchange carries the time it happened.

TIME
- The current time and a calendar are in CONTEXT. Read dates off the calendar and off memory timestamps. Do not compute dates yourself.

MEMORY
- The MEMORY section was retrieved for this message by the system. It is the complete record of what you can remember; you cannot fetch more.
- When the user refers to a past exchange, find it in MEMORY and state its actual date ("On Tue 3 Nov you asked ...").
- A time phrase may map to several candidate days. Use the one whose exchanges fit what the user describes.
- If MEMORY has nothing for the time or topic the user refers to, say that plainly, then offer the nearest thing you do have or ask what they meant. Never invent a past conversation, a date, or an earlier answer.

SEARCH
- Search for anything that can change (prices, plans, releases, versions, news, people, availability) and for anything you are unsure of. Do not search for small talk or for questions MEMORY alone answers.
- Ask for every search you need in one step, as parallel calls, each a specific query (name + what + year). Search again only if the results leave a real gap.
- "Is that still correct?" or "has anything changed since?": re-check the specific facts in your earlier answer against fresh results. Then say what changed (old value, new value, dates), what is unchanged, and what you could not verify. Use the since parameter to find news after the earlier date.

ANSWERING
- Lead with the answer. Then only the detail that matters. No preamble, no recap of the question, no closing offer.
- Plain markdown: short paragraphs, bold, bullet lists. No tables, no headings.
- Cite facts from sources inline as [n], using the numbers shown next to each result or remembered source. Never cite a number you were not given.
- If results conflict or are thin, say so instead of guessing. Give prices with currency and billing period.`

const CALENDAR_DAYS = 14
const WINDOW_ANSWER_CHARS = 1400 // an exchange the user pointed at: keep nearly all of it
const RELATED_ANSWER_CHARS = 500
const THREAD_ANSWER_CHARS = 800
const TIMELINE_QUESTION_CHARS = 90
const SOURCES_PER_TURN = 3

const DAY = 86_400_000
// Old answers lose their [n] markers: those numbers belonged to an earlier turn's
// source list and would collide with this turn's numbering.
const clip = (text: string, max: number) => {
  const plain = text.replace(/\s?\[\d+\]/g, '')
  return plain.length > max ? `${plain.slice(0, max)} [...]` : plain
}

// `cite` registers a source and returns its number, so remembered sources and fresh
// search results share one numbering for the whole turn.
export function contextBlock(memory: Recall, now: Date, tz: number, cite: (s: Source) => number): string {
  const nowMs = now.getTime()
  const calendar = Array.from({ length: CALENDAR_DAYS }, (_, i) => {
    const tag = i === 0 ? ' (today)' : i === 1 ? ' (yesterday)' : ''
    return fmtDay(nowMs - i * DAY, tz) + tag
  })

  const exchange = (t: Turn, answerChars: number) =>
    [
      `  [${fmtDay(t.askedAt, tz)} ${fmtTime(t.askedAt, tz)}] User asked: ${t.question}`,
      `  You answered: ${clip(t.answer, answerChars)}`,
      ...t.sources.slice(0, SOURCES_PER_TURN).map((s) => `  Source then [${cite(s)}]: ${s.title} ${s.url}`),
    ].join('\n')

  const lines = [
    'CONTEXT',
    `Now: ${fmtDay(nowMs, tz)}, ${fmtTime(nowMs, tz)} (user's local time)`,
    `Calendar, newest first: ${calendar.join(' | ')}`,
    '',
    'MEMORY',
  ]

  if (!memory.timeline.length) lines.push('Empty. This user has no earlier exchanges with you.')

  for (const w of memory.windows) {
    const count = w.turns.length ? `${w.turns.length} exchange(s)` : 'no exchanges recorded'
    lines.push(`"${w.phrase}" could mean ${w.label}: ${count}`)
    lines.push(...w.turns.map((t) => exchange(t, WINDOW_ANSWER_CHARS)))
  }
  if (memory.related.length) {
    lines.push('Related by topic, from any date:')
    lines.push(...memory.related.map((t) => exchange(t, RELATED_ANSWER_CHARS)))
  }
  if (memory.timeline.length) {
    lines.push('Most recent questions, newest first:')
    lines.push(...memory.timeline.map((t) => `  ${fmtDay(t.askedAt, tz)} ${fmtTime(t.askedAt, tz)}: ${clip(t.question, TIMELINE_QUESTION_CHARS)}`))
  }
  return lines.join('\n')
}

// Earlier turns of the open conversation, replayed verbatim so follow-ups work.
export function threadMessages(turns: Turn[]): { role: 'user' | 'assistant'; content: string }[] {
  return turns.flatMap((t) => [
    { role: 'user' as const, content: t.question },
    { role: 'assistant' as const, content: clip(t.answer, THREAD_ANSWER_CHARS) },
  ])
}
