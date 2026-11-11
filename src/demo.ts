// Demo memory: replays three real questions through the real agent with the clock
// set in the past, so "what did I ask last Tuesday?" has something to find on day one.
// Nothing is faked except the timestamp; the answers come from live searches.
import { answer, type AgentEvent, type Deps } from './agent.ts'
import { threadTurns } from './memory.ts'
import { resolveTime } from './time.ts'

export type DemoEvent =
  | { type: 'demo'; step: number; total: number; label: string; question: string }
  | { type: 'demo-done' }
  | AgentEvent

const HOUR = 3_600_000

// Days are named the way a user would name them and resolved by the agent's own
// time resolver, so the demo and the questions about it can never disagree.
const SCRIPT = [
  { id: 'demo-nov3', day: '3 November', hour: 11.5, question: 'What is the current Node.js LTS version, and when does its support end?' },
  { id: 'demo-monday', day: 'Monday', hour: 10.5, question: 'We are a 20-person sales team. Shortlist 5 CRM tools with their per-seat pricing.' },
  { id: 'demo-tuesday', day: 'Tuesday', hour: 15, question: 'Compare managed Postgres hosting for a small startup: Neon, Supabase, Render and AWS RDS. What does each cost?' },
]

export async function* loadDemo(deps: Deps, userId: string, tz: number): AsyncGenerator<DemoEvent> {
  const now = deps.now()
  const planned = SCRIPT.flatMap((item) => {
    const day = resolveTime(item.day, now, tz).find((w) => w.to <= now.getTime()) // a day that is fully over
    return day ? [{ ...item, label: day.label, at: day.from + item.hour * HOUR }] : []
  }).sort((a, b) => a.at - b.at)

  for (const [i, item] of planned.entries()) {
    const alreadyLoaded = (await threadTurns(deps.db, userId, item.id, 1)).length > 0
    if (alreadyLoaded) continue
    yield { type: 'demo', step: i + 1, total: planned.length, label: item.label, question: item.question }
    const past: Deps = { ...deps, now: () => new Date(item.at) }
    for await (const event of answer(past, { userId, threadId: item.id, message: item.question, tz })) {
      if (event.type !== 'error') continue
      yield event
      return
    }
  }
  yield { type: 'demo-done' }
}
