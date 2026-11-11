// The one tool: web search (Firecrawl). Returns short query-relevant excerpts, not
// whole pages, because excerpts are what keeps the second model call small and fast.

export interface Hit {
  title: string
  url: string
  snippet: string
}

// `since` is YYYY-MM-DD: only pages published on or after that day.
export type Search = (query: string, since?: string) => Promise<Hit[]>

const RESULTS_PER_QUERY = 4
const SNIPPET_CHARS = 450
const TIMEOUT_MS = 10_000

// The tool schema the model sees.
export const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the live web. Returns numbered results with excerpts. Call it several times in one step to run searches in parallel.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A specific search query, e.g. "HubSpot Sales Hub Starter price per seat 2026"' },
        since: { type: 'string', description: 'Optional YYYY-MM-DD. Only pages published on or after this date. Use it for "what changed since ...".' },
      },
      required: ['query'],
    },
  },
}

export function createSearch(apiKey: string): Search {
  return async (query, since) => {
    const res = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, limit: RESULTS_PER_QUERY, ...(since && { tbs: publishedSince(since) }) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`search failed (${res.status})`)
    const json = (await res.json()) as { data?: { web?: { title?: string; url: string; description?: string }[] } }
    return (json.data?.web ?? []).map((hit) => ({
      title: hit.title ?? hit.url,
      url: hit.url,
      snippet: (hit.description ?? '').replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS),
    }))
  }
}

// YYYY-MM-DD -> the search engine's custom date range syntax.
export function publishedSince(since: string): string | undefined {
  const [, y, m, d] = since.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? []
  return y && `cdr:1,cd_min:${m}/${d}/${y}`
}
