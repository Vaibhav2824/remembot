// The one tool: web search (Firecrawl). Returns short query-relevant excerpts, not
// whole pages, because excerpts are what keeps the second model call small and fast.

export interface Hit {
  title: string
  url: string
  snippet: string
}

export type Search = (query: string) => Promise<Hit[]>

const RESULTS_PER_QUERY = 3
const SNIPPET_CHARS = 500
const TIMEOUT_MS = 10_000

// The tool schema the model sees. One call takes a list of queries: not every model
// can emit several tool calls in one step, but every model can fill in an array.
export const WEB_SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'web_search',
    description: 'Search the live web. Takes a list of queries, runs them all in parallel, and returns numbered results with excerpts for each.',
    parameters: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Specific queries, one per thing you need to know, e.g. ["HubSpot Sales Hub Starter price per seat 2026", "Pipedrive pricing per seat 2026"]',
        },
      },
      required: ['queries'],
    },
  },
}

export function createSearch(apiKey: string): Search {
  return async (query) => {
    const res = await fetch('https://api.firecrawl.dev/v2/search', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, limit: RESULTS_PER_QUERY }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 429) throw new Error('the search provider is rate-limiting this key')
    if (!res.ok) throw new Error(`the search provider returned ${res.status}`)
    const json = (await res.json()) as { data?: { web?: { title?: string; url: string; description?: string }[] } }
    return (json.data?.web ?? []).map((hit) => ({
      title: hit.title ?? hit.url,
      url: hit.url,
      snippet: (hit.description ?? '').replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS),
    }))
  }
}
