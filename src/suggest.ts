// Cards for a returning user: for each of their latest chats, a short topic and one question
// that asks what has changed since. The model writes them once per chat; they are cached.
import type { Chat } from './llm.ts'
import { listThreads, type Db, type ThreadSummary } from './memory.ts'

export interface Suggestion {
  threadId: string
  updatedAt: number
  topic: string
  followup: string
}

interface Note {
  topic: string
  followup: string
}

const CARDS = 3

export async function suggestions(db: Db, chat: Chat, userId: string, tz: number, now = Date.now()): Promise<Suggestion[]> {
  const threads = await listThreads(db, userId, CARDS)
  if (!threads.length) return []
  const rows = await db.all<Note & { thread_id: string }>(
    `SELECT thread_id, topic, followup FROM thread_notes WHERE user_id = ? AND thread_id IN (${threads.map(() => '?').join(', ')})`,
    userId,
    ...threads.map((t) => t.id),
  )
  // A cached question holds {when}, filled at display time; older ones froze a date in and get rewritten.
  const notes = new Map(rows.filter((r) => r.followup.includes(WHEN)).map((r) => [r.thread_id, { topic: r.topic, followup: r.followup }]))
  const missing = threads.filter((t) => !notes.has(t.id))
  if (missing.length) {
    const written = await write(chat, missing)
    for (const t of missing) {
      const note = written.get(t.id) ?? plainNote(t)
      notes.set(t.id, note)
      await db.run('INSERT OR REPLACE INTO thread_notes (user_id, thread_id, topic, followup) VALUES (?, ?, ?, ?)', userId, t.id, note.topic, note.followup)
    }
  }
  return threads.map((t) => {
    const note = notes.get(t.id)!
    return { threadId: t.id, updatedAt: t.updatedAt, topic: note.topic, followup: note.followup.replace(WHEN, when(t.updatedAt, tz, now)) }
  })
}

const WHEN = '{when}'
const dayKey = (ms: number, tz: number) => new Date(ms + tz * 60_000).toISOString().slice(0, 10)

// "earlier today", "yesterday", "on 10 Nov": relative to the user's own calendar day.
export function when(ms: number, tz: number, now: number): string {
  if (dayKey(ms, tz) === dayKey(now, tz)) return 'earlier today'
  if (dayKey(ms, tz) === dayKey(now - 86_400_000, tz)) return 'yesterday'
  return `on ${new Date(ms + tz * 60_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
}

// Used when the model fails or writes something unusable.
function plainNote(t: ThreadSummary): Note {
  return { topic: t.title.split(/\s+/).slice(0, 4).join(' '), followup: `Has anything changed since I asked about this ${WHEN}?` }
}

async function write(chat: Chat, threads: ThreadSummary[]): Promise<Map<string, Note>> {
  const list = threads.map((t) => ({ id: t.id, question: t.title.slice(0, 300) }))
  const out = new Map<string, Note>()
  try {
    let text = ''
    for await (const part of chat([
      {
        role: 'system',
        content:
          'For each past chat, write a topic of 2 to 4 words in Title Case naming its subject, and one follow-up question of at most 20 words, in the first person, asking what has changed since it was asked. Never write a date: put the exact token {when} where the time goes, e.g. "Has the price changed since I asked {when}?". Reply with JSON only: {"items":[{"id":"...","topic":"...","followup":"..."}]}',
      },
      { role: 'user', content: JSON.stringify(list) },
    ]))
      if (typeof part === 'string') text += part
    const items: unknown = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).items
    for (const item of Array.isArray(items) ? items : []) {
      const { id, topic, followup } = item as Record<string, unknown>
      if (typeof id !== 'string' || typeof topic !== 'string' || typeof followup !== 'string') continue
      if (!topic.trim() || topic.length > 40 || !followup.includes(WHEN) || followup.length > 180) continue
      out.set(id, { topic: topic.trim(), followup: followup.trim() })
    }
  } catch (err) {
    console.warn('suggestions: falling back to plain notes', err instanceof Error ? err.message : err)
  }
  return out
}
