// Long-term memory: every exchange, stamped with when it happened, in SQLite.
// Recall is plain code (time windows + keyword search), so it costs ~1 ms and no model call.
import { resolveTime, type Window } from './time.ts'

// The only thing the two runtimes implement differently (node:sqlite vs D1).
export interface Db {
  run(sql: string, ...params: unknown[]): Promise<void>
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>
}

export interface Source {
  title: string
  url: string
}

export interface Turn {
  id: number
  threadId: string
  askedAt: number
  question: string
  answer: string
  sources: Source[]
}

export interface Recall {
  windows: (Window & { turns: Turn[] })[] // what happened in each time the user named
  related: Turn[] // best keyword matches from any time
  timeline: Turn[] // most recent exchanges, newest first
}

const PER_WINDOW = 6
const RELATED = 3
const TIMELINE = 12
const MAX_KEYWORDS = 8

interface Row {
  id: number
  thread_id: string
  asked_at: number
  question: string
  answer: string
  sources: string
}

const toTurn = (r: Row): Turn => ({
  id: r.id,
  threadId: r.thread_id,
  askedAt: r.asked_at,
  question: r.question,
  answer: r.answer,
  sources: JSON.parse(r.sources) as Source[],
})

export async function remember(db: Db, userId: string, turn: Omit<Turn, 'id'>): Promise<number> {
  const [{ id }] = await db.all<{ id: number }>(
    'INSERT INTO turns (user_id, thread_id, asked_at, question, answer, sources) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    userId,
    turn.threadId,
    turn.askedAt,
    turn.question,
    turn.answer,
    JSON.stringify(turn.sources),
  )
  await db.run('INSERT INTO turns_fts (rowid, question, answer) VALUES (?, ?, ?)', id, turn.question, turn.answer)
  return id
}

export async function recall(db: Db, userId: string, message: string, now: Date, tz: number): Promise<Recall> {
  const windows = resolveTime(message, now, tz)
  const keywords = keywordsOf(windows.reduce((text, w) => text.replace(w.phrase, ' '), message))

  // Everything is bounded by `now`, so a replayed (time-travelled) turn never sees its future.
  const [inWindows, matches, timeline] = await Promise.all([
    Promise.all(windows.map((w) => turnsBetween(db, userId, w.from, Math.min(w.to, now.getTime())))),
    keywordMatches(db, userId, keywords, now.getTime()),
    recentTurns(db, userId, TIMELINE, now.getTime()),
  ])

  const filled = windows.map((w, i) => ({ ...w, turns: mostRelevant(inWindows[i], keywords, PER_WINDOW) }))
  const seen = new Set(filled.flatMap((w) => w.turns.map((t) => t.id)))
  return { windows: filled, related: matches.filter((t) => !seen.has(t.id)).slice(0, RELATED), timeline }
}

export async function threadTurns(db: Db, userId: string, threadId: string, limit: number): Promise<Turn[]> {
  const rows = await db.all<Row>(
    'SELECT * FROM turns WHERE user_id = ? AND thread_id = ? ORDER BY asked_at DESC LIMIT ?',
    userId,
    threadId,
    limit,
  )
  return rows.map(toTurn).reverse()
}

export async function recentTurns(db: Db, userId: string, limit: number, before = Number.MAX_SAFE_INTEGER): Promise<Turn[]> {
  const rows = await db.all<Row>(
    'SELECT * FROM turns WHERE user_id = ? AND asked_at < ? ORDER BY asked_at DESC LIMIT ?',
    userId,
    before,
    limit,
  )
  return rows.map(toTurn)
}

// Counts by real write time, so replayed (backdated) turns still count toward spend.
export async function countTurnsSince(db: Db, since: number): Promise<number> {
  const [{ n }] = await db.all<{ n: number }>('SELECT count(*) AS n FROM turns WHERE created_at >= ?', since)
  return n
}

async function turnsBetween(db: Db, userId: string, from: number, to: number): Promise<Turn[]> {
  const rows = await db.all<Row>(
    'SELECT * FROM turns WHERE user_id = ? AND asked_at >= ? AND asked_at < ? ORDER BY asked_at LIMIT 50',
    userId,
    from,
    to,
  )
  return rows.map(toTurn)
}

// ponytail: BM25 over stemmed keywords misses pure paraphrase ("that database thing").
// The always-present timeline covers recent turns; add embeddings when history is long.
async function keywordMatches(db: Db, userId: string, keywords: string[], before: number): Promise<Turn[]> {
  if (!keywords.length) return []
  const query = keywords.map((k) => `"${k}"`).join(' OR ')
  const rows = await db.all<Row>(
    `SELECT t.* FROM turns_fts JOIN turns t ON t.id = turns_fts.rowid
     WHERE turns_fts MATCH ? AND t.user_id = ? AND t.asked_at < ?
     ORDER BY bm25(turns_fts, 3.0, 1.0) LIMIT ?`,
    query,
    userId,
    before,
    RELATED + PER_WINDOW * 2,
  )
  return rows.map(toTurn)
}

// A busy window (a whole week) can hold more turns than fit: keep the ones on topic.
function mostRelevant(turns: Turn[], keywords: string[], limit: number): Turn[] {
  if (turns.length <= limit) return turns
  const hits = (t: Turn) => keywords.filter((k) => `${t.question} ${t.answer}`.toLowerCase().includes(k)).length
  return [...turns]
    .sort((a, b) => hits(b) - hits(a) || b.askedAt - a.askedAt)
    .slice(0, limit)
    .sort((a, b) => a.askedAt - b.askedAt)
}

const STOPWORDS = new Set(
  `about after again all also and any are ask asked been before but can changed correct could did does done
   ever for from had has have how its just know last like more much new not now one our out said say she since
   something still tell than that the their them then there these they thing this told was were what when where
   which who why will with would you your`.split(/\s+/),
)

export function keywordsOf(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)))].slice(0, MAX_KEYWORDS)
}
