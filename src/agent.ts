// One turn of the agent:
//   recall (code, ~1 ms)  ->  model  ->  parallel web searches  ->  model streams the answer  ->  remember
//
// Memory is injected as context, never exposed as a tool: the brief allows one tool,
// it saves a model round trip, and the model cannot forget to look.
import type { Chat, Msg, ToolCall } from './llm.ts'
import { recall, remember, threadTurns, type Db, type Source } from './memory.ts'
import { contextBlock, SYSTEM, threadMessages } from './prompt.ts'
import { WEB_SEARCH_TOOL, type Search } from './search.ts'

// Everything the agent touches from outside. Tests pass fakes; `now` makes time travel possible.
export interface Deps {
  db: Db
  chat: Chat
  search: Search
  now: () => Date
}

export interface Ask {
  userId: string
  threadId: string
  message: string
  tz: number // user's UTC offset, minutes
}

export type AgentEvent =
  | { type: 'memory'; windows: { phrase: string; label: string; count: number }[]; related: number }
  | { type: 'search'; queries: string[] }
  | { type: 'sources'; sources: (Source & { n: number })[] }
  | { type: 'text'; delta: string }
  | { type: 'done'; turnId: number; askedAt: number; ms: number; searches: number }
  | { type: 'error'; message: string }

const MAX_SEARCH_ROUNDS = 2 // after this the model must answer with what it has
const MAX_SEARCHES_PER_ROUND = 6
const THREAD_TURNS = 3

export async function* answer(deps: Deps, ask: Ask): AsyncGenerator<AgentEvent> {
  const startedAt = Date.now()
  const now = deps.now()
  try {
    const [memory, thread] = await Promise.all([
      recall(deps.db, ask.userId, ask.message, now, ask.tz),
      threadTurns(deps.db, ask.userId, ask.threadId, THREAD_TURNS),
    ])
    yield {
      type: 'memory',
      windows: memory.windows.map((w) => ({ phrase: w.phrase, label: w.label, count: w.turns.length })),
      related: memory.related.length,
    }

    // One numbered source list per turn, shared by remembered sources and new results.
    const sources: Source[] = []
    const cite = (s: Source) => {
      const known = sources.findIndex((x) => x.url === s.url)
      return known >= 0 ? known + 1 : sources.push({ title: s.title, url: s.url })
    }

    const numbered = () => ({ type: 'sources' as const, sources: sources.map((s, i) => ({ ...s, n: i + 1 })) })

    const messages: Msg[] = [
      { role: 'system', content: `${SYSTEM}\n\n${contextBlock(memory, now, ask.tz, cite)}` },
      ...threadMessages(thread),
      { role: 'user', content: ask.message },
    ]
    if (sources.length) yield numbered()

    let text = ''
    let searches = 0
    for (let round = 0; ; round++) {
      const canSearch = round < MAX_SEARCH_ROUNDS
      const stream = deps.chat(messages, canSearch ? [WEB_SEARCH_TOOL] : undefined)
      text = ''
      let step = await stream.next()
      while (!step.done) {
        text += step.value
        yield { type: 'text', delta: step.value }
        step = await stream.next()
      }
      const calls = step.value.filter((c) => c.name === WEB_SEARCH_TOOL.function.name)
      if (!calls.length) break

      const queries = calls.map(parseArgs)
      yield { type: 'search', queries: queries.slice(0, MAX_SEARCHES_PER_ROUND).map((q) => q.query) }
      // All searches of a round run at once: the round costs one search's latency, not the sum.
      const results = await Promise.all(
        queries.map(async ({ query, since }, i) => {
          if (i >= MAX_SEARCHES_PER_ROUND) return 'Skipped: too many searches in one step.'
          if (!query) return 'Invalid search: no query given.'
          try {
            const hits = await deps.search(query, since)
            if (!hits.length) return 'No results.'
            return hits.map((h) => `[${cite(h)}] ${h.title}\n${h.url}\n${h.snippet}`).join('\n\n')
          } catch (err) {
            return `Search failed: ${err instanceof Error ? err.message : err}`
          }
        }),
      )
      searches += Math.min(queries.length, MAX_SEARCHES_PER_ROUND)
      yield numbered()

      messages.push({
        role: 'assistant',
        content: text,
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
      })
      calls.forEach((c, i) => messages.push({ role: 'tool', tool_call_id: c.id, content: results[i] }))
    }

    if (!text.trim()) throw new Error('The model returned an empty answer.')
    const askedAt = now.getTime()
    const turnId = await remember(deps.db, ask.userId, {
      threadId: ask.threadId,
      askedAt,
      question: ask.message,
      ...keepCited(text, sources),
    })
    yield { type: 'done', turnId, askedAt, ms: Date.now() - startedAt, searches }
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

function parseArgs(call: ToolCall): { query: string; since?: string } {
  try {
    const args = JSON.parse(call.args || '{}')
    return { query: String(args.query ?? '').trim(), since: typeof args.since === 'string' ? args.since : undefined }
  } catch {
    return { query: '' }
  }
}

// Store only the sources the answer used, renumbered from 1 so a stored answer and
// its source list make sense on their own. Citations of numbers that were never
// handed out are dropped.
export function keepCited(text: string, sources: Source[]): { answer: string; sources: Source[] } {
  const cited = [...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))
  const used = [...new Set(cited)].filter((n) => sources[n - 1])
  return {
    answer: text.replace(/\[(\d+)\]/g, (_, n) => (used.includes(Number(n)) ? `[${used.indexOf(Number(n)) + 1}]` : '')),
    sources: used.map((n) => sources[n - 1]),
  }
}
