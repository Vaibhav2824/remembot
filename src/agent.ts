// One turn of the agent:
//   recall (code, ~1 ms)  ->  model  ->  parallel web searches  ->  model streams the answer  ->  remember
//
// Memory is injected as context, never exposed as a tool: the brief allows one tool,
// it saves a model round trip, and the model cannot forget to look.
import type { Chat, Msg, ToolCall } from './llm.ts'
import { recall, remember, threadTurns, type Db, type Source } from './memory.ts'
import { contextBlock, SYSTEM, threadMessages } from './prompt.ts'
import { WEB_SEARCH_TOOL, type Hit, type Search } from './search.ts'

// Everything the agent touches from outside. Tests pass fakes; `now` makes time travel possible.
export interface Deps {
  db: Db
  chat: Chat
  search: Search
  now: () => Date
  preSearch?: boolean // search the message itself while memory is recalled (saves a model round trip)
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
  | { type: 'wait'; seconds: number } // the model provider is rate-limiting us
  | { type: 'done'; turnId: number; askedAt: number; ms: number; searches: number }
  | { type: 'error'; message: string }

// A turn's cost is bounded two ways: how many searches it may run, and how many
// times it may call the model. The model is told what it has left after each search.
const MAX_QUERIES_PER_TURN = 6
// Questions about the conversation itself: searching their words would only find noise.
const ABOUT_MEMORY = /\b(did I|I asked|we (asked|discussed|talked|shortlisted|compared)|you (said|told|answered|found))\b/i
const MAX_MODEL_CALLS = 4 // the last one is made without the tool, so it has to answer
const THREAD_TURNS = 3

export async function* answer(deps: Deps, ask: Ask): AsyncGenerator<AgentEvent> {
  const startedAt = Date.now()
  const now = deps.now()
  // The web search for the message starts now, beside recall: by the time memory is ready
  // the results are usually in, and the model can answer in one call instead of two.
  const early = deps.preSearch && ask.message.split(/\s+/).length >= 3 && !ABOUT_MEMORY.test(ask.message) ? deps.search(ask.message) : undefined
  early?.catch(() => {}) // awaited (and reported) below; never an unhandled rejection
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
    let queriesLeft = MAX_QUERIES_PER_TURN
    const budgetNote = () =>
      queriesLeft
        ? `${queriesLeft} search queries left this message. Answer now unless a specific fact is still missing.`
        : 'No search queries left this message. Answer now from the results above and MEMORY, and say what you could not verify.'
    if (early) {
      // Shown to the model as a search it already made, so it answers from it or searches for more.
      yield { type: 'search', queries: [ask.message] }
      const block = await searchBlock(deps.search, ask.message, cite, early)
      queriesLeft--
      yield numbered()
      const args = JSON.stringify({ queries: [ask.message] })
      messages.push({ role: 'assistant', content: '', tool_calls: [{ id: 'presearch', type: 'function', function: { name: WEB_SEARCH_TOOL.function.name, arguments: args } }] })
      messages.push({ role: 'tool', tool_call_id: 'presearch', content: `${block}

${budgetNote()}` })
    }
    for (let modelCall = 1; ; modelCall++) {
      const isLastCall = modelCall === MAX_MODEL_CALLS
      const stream = deps.chat(messages, isLastCall ? undefined : [WEB_SEARCH_TOOL])
      text = ''
      let step = await stream.next()
      while (!step.done) {
        if (typeof step.value === 'string') {
          text += step.value
          yield { type: 'text', delta: step.value }
        } else {
          yield { type: 'wait', seconds: step.value.waitSeconds }
        }
        step = await stream.next()
      }
      const calls = step.value.filter((c) => c.name === WEB_SEARCH_TOOL.function.name)
      if (!calls.length) {
        if (text.trim() || isLastCall) break
        continue // said nothing and asked for nothing (it happens): ask again
      }

      // Hand out what is left of the turn's query budget, in the order asked.
      const plans = calls.map((call) => {
        const queries = parseQueries(call).slice(0, queriesLeft)
        queriesLeft -= queries.length
        return queries
      })
      const asked = plans.flat()
      if (asked.length) yield { type: 'search', queries: asked }
      // Every query of the step runs at once: the step costs one search's latency, not the sum.
      const results = await Promise.all(plans.map((queries) => Promise.all(queries.map((q) => searchBlock(deps.search, q, cite)))))
      if (asked.length) yield numbered()

      messages.push({
        role: 'assistant',
        content: text,
        tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
      })
      calls.forEach((c, i) => messages.push({ role: 'tool', tool_call_id: c.id, content: [...results[i], budgetNote()].join('\n\n') }))
    }

    if (!text.trim()) throw new Error('The model returned an empty answer. Please try again.')
    const askedAt = now.getTime()
    const turnId = await remember(deps.db, ask.userId, {
      threadId: ask.threadId,
      askedAt,
      question: ask.message,
      ...keepCited(text, sources),
    })
    yield { type: 'done', turnId, askedAt, ms: Date.now() - startedAt, searches: MAX_QUERIES_PER_TURN - queriesLeft }
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}

// One query's results as the model sees them. A failed search is reported, not thrown,
// so one bad query cannot sink the turn and the model can say what it could not check.
async function searchBlock(search: Search, query: string, cite: (s: Source) => number, pending?: Promise<Hit[]>): Promise<string> {
  try {
    const hits = await (pending ?? search(query))
    const body = hits.map((h) => `[${cite(h)}] ${h.title}\n${h.url}\n${h.snippet}`).join('\n\n')
    return `Results for "${query}":\n${body || 'No results.'}`
  } catch (err) {
    return `Results for "${query}":\nSearch failed: ${err instanceof Error ? err.message : err}`
  }
}

// Models send {queries: [...]}; tolerate a lone {query: "..."} too.
function parseQueries(call: ToolCall): string[] {
  try {
    const args = JSON.parse(call.args || '{}')
    const list: unknown[] = Array.isArray(args.queries) ? args.queries : [args.query]
    return list.filter((q): q is string => typeof q === 'string' && !!q.trim()).map((q) => q.trim())
  } catch {
    return []
  }
}

// Store only the sources the answer used, renumbered from 1 so a stored answer and
// its source list make sense on their own. Citations of numbers that were never
// handed out are dropped.
export function keepCited(text: string, sources: Source[]): { answer: string; sources: Source[] } {
  const plain = text
    .replace(/【(\d+)[^】]*】/g, '[$1]') // some models cite as 【1†L2-L5】
    .replace(/(\[\d+\])(?:\s*\1)+/g, '$1') // ...and then repeat the same number
  const cited = [...plain.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]))
  const used = [...new Set(cited)].filter((n) => sources[n - 1])
  return {
    answer: plain.replace(/\[(\d+)\]/g, (_, n) => (used.includes(Number(n)) ? `[${used.indexOf(Number(n)) + 1}]` : '')),
    sources: used.map((n) => sources[n - 1]),
  }
}
