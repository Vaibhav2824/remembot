// Time phrases -> candidate windows. Code does the calendar so the model never has to.
//
// A phrase is resolved to one or more *candidate* windows rather than a single
// answer: "last Tuesday" said on a Thursday can mean two different days, and
// "3/11" is 3 Nov in India and 11 Mar in the US. Memory decides which one is real.
import * as chrono from 'chrono-node'

export interface Window {
  phrase: string // the user's words, e.g. "last Tuesday"
  label: string // what it resolved to, e.g. "Tue 10 Nov 2026"
  from: number // epoch ms, inclusive
  to: number // epoch ms, exclusive
}

const DAY = 86_400_000
const MAX_WINDOWS = 4
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// `tz` is the user's UTC offset in minutes (IST = 330). A "local" Date is shifted
// so its getUTC* fields read as the user's wall clock.
// ponytail: one fixed offset per request, so windows are off by an hour across a
// DST change. Pass an IANA zone and use Intl if that ever matters.
const local = (ms: number, tz: number) => new Date(ms + tz * 60_000)
const midnight = (y: number, m: number, d: number, tz: number) => Date.UTC(y, m - 1, d) - tz * 60_000

export function fmtDay(ms: number, tz: number): string {
  const d = local(ms, tz)
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

export function fmtTime(ms: number, tz: number): string {
  return local(ms, tz).toISOString().slice(11, 16)
}

export function resolveTime(text: string, now: Date, tz: number): Window[] {
  const nowMs = now.getTime()
  const today = local(nowMs, tz)
  const [Y, M, D] = [today.getUTCFullYear(), today.getUTCMonth() + 1, today.getUTCDate()]
  const out: Window[] = []

  const add = (phrase: string, label: string, from: number, to: number) => {
    const isPast = from <= nowMs
    const isNew = !out.some((w) => w.from === from && w.to === to)
    if (isPast && isNew) out.push({ phrase, label, from, to })
  }
  const addDay = (phrase: string, y: number, m: number, d: number) => {
    const from = midnight(y, m, d, tz)
    add(phrase, fmtDay(from, tz), from, from + DAY)
  }
  // People ask about the past: a date with no year means its latest occurrence.
  const addPastDay = (phrase: string, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return
    addDay(phrase, midnight(Y, m, d, tz) <= nowMs ? Y : Y - 1, m, d)
  }

  for (const r of chrono.parse(text, { instant: now, timezone: tz }, { forwardDate: false })) {
    const s = r.start
    const phrase = r.text
    const [y, m, d] = [s.get('year') ?? Y, s.get('month') ?? M, s.get('day') ?? D]
    const numeric = phrase.match(/(\d{1,2})[/.](\d{1,2})(?![/.]\d)/)

    if (/month/i.test(phrase) || (s.isCertain('month') && !s.isCertain('day'))) {
      if (isModalVerb(text, r.index, phrase)) continue
      const year = s.isCertain('year') || midnight(y, m, 1, tz) <= nowMs ? y : y - 1
      add(phrase, `${MONTHS[m - 1]} ${year}`, midnight(year, m, 1, tz), midnight(year, m + 1, 1, tz))
    } else if (/week/i.test(phrase)) {
      const at = midnight(y, m, d, tz)
      const sinceMonday = (local(at, tz).getUTCDay() + 6) % 7
      const from = at - sinceMonday * DAY
      add(phrase, `week of ${fmtDay(from, tz)}`, from, from + 7 * DAY)
    } else if (s.isCertain('weekday') && !s.isCertain('day')) {
      // Bare weekday: the latest one, and the one before it as a second candidate.
      const back = (today.getUTCDay() - s.get('weekday')! + 7) % 7
      addDay(phrase, Y, M, D - back)
      addDay(phrase, Y, M, D - back - 7)
    } else if (numeric && !s.isCertain('year')) {
      // 3/11: day-first and month-first are both plausible.
      addPastDay(phrase, Number(numeric[2]), Number(numeric[1]))
      addPastDay(phrase, Number(numeric[1]), Number(numeric[2]))
    } else if (s.isCertain('day')) {
      if (s.isCertain('year')) addDay(phrase, y, m, d)
      else addPastDay(phrase, m, d)
    } else if (/today|tonight|morning|afternoon|evening/i.test(phrase)) {
      addDay(phrase, y, m, d)
    }
    // Anything else (e.g. "at 5pm") names no day, so it is not a memory window.
  }

  // "on the 3rd": chrono skips it; it means the latest 3rd of a month.
  for (const hit of text.matchAll(/\bon the (\d{1,2})(?:st|nd|rd|th)\b/gi)) {
    const d = Number(hit[1])
    if (d >= 1 && d <= 31) addDay(hit[0], Y, d <= D ? M : M - 1, d)
  }

  return out.slice(0, MAX_WINDOWS)
}

// "may I ask" and "march on" are not months. Trust them only after a preposition.
function isModalVerb(text: string, index: number, phrase: string): boolean {
  return /^(may|march)$/i.test(phrase) && !/\b(in|last|since|during|of|this)\s+$/i.test(text.slice(0, index))
}
