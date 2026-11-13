// Streaming chat completions against any OpenAI-compatible endpoint (Groq by default).
// Plain fetch: runs unchanged on Node and on Cloudflare Workers.

export interface ToolCall {
  id: string
  name: string
  args: string // JSON text, as the model wrote it
}

export type Msg =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[] }
  | { role: 'tool'; tool_call_id: string; content: string }

// Yields answer text as it arrives, or { waitSeconds } while backing off from a rate
// limit; returns the tool calls the model asked for (if any).
export type Chat = (messages: Msg[], tools?: object[]) => AsyncGenerator<string | { waitSeconds: number }, ToolCall[]>

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  reasoningEffort?: string
  serviceTier?: string // OpenAI "fast": up to 2.5x quicker, at 2x the token price
}

const MAX_OUTPUT_TOKENS = 1500
const MAX_RATE_LIMIT_WAIT_S = 45 // total, across retries, before giving up on a turn

// With a fallback, a primary that is rate-limited, down or unreachable hands the turn over
// at once: a fast cheap primary (Groq) backed by a reliable one (OpenAI) never makes a user wait.
export function createChat(cfg: LlmConfig, fallback?: LlmConfig): Chat {
  const backup = fallback && createChat(fallback)
  const post = (body: object) =>
    fetch(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  return async function* (messages, tools) {
    const body = {
      model: cfg.model,
      messages,
      stream: true,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      ...(tools && { tools, tool_choice: 'auto' }),
      ...(cfg.reasoningEffort && { reasoning_effort: cfg.reasoningEffort }),
      ...(cfg.serviceTier && { service_tier: cfg.serviceTier }),
    }

    const first = await post(body).catch((err) => {
      if (backup) return undefined
      throw err
    })
    if (backup && (!first || first.status === 429 || first.status >= 500)) {
      console.warn(`${cfg.model} ${first ? `returned ${first.status}` : 'unreachable'}: answering with ${fallback!.model}`)
      return yield* backup(messages, tools)
    }
    let res = first!
    // Free tiers have tight per-minute token budgets. Waiting as long as the provider
    // asks, and saying so, beats failing the turn.
    for (let waited = 0; res.status === 429; res = await post(body)) {
      const waitSeconds = Math.ceil(Number(res.headers.get('retry-after') ?? 2))
      waited += waitSeconds || 1
      if (waited > MAX_RATE_LIMIT_WAIT_S) break
      yield { waitSeconds }
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
    }
    if (!res.ok || !res.body) throw new Error(`Model request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)

    const calls: ToolCall[] = []
    for await (const data of sseData(res.body)) {
      const chunk = JSON.parse(data)
      // Providers can fail mid-stream (e.g. a malformed tool call) with a 200 status.
      if (chunk.error) throw new Error(`Model stream failed: ${String(chunk.error.message ?? chunk.error).slice(0, 300)}`)
      const delta = chunk.choices?.[0]?.delta
      if (delta?.content) yield delta.content as string
      // Tool calls stream in fragments, keyed by index.
      for (const part of delta?.tool_calls ?? []) {
        const call = (calls[part.index] ??= { id: '', name: '', args: '' })
        if (part.id) call.id = part.id
        if (part.function?.name) call.name = part.function.name
        call.args += part.function?.arguments ?? ''
      }
    }
    return calls.filter(Boolean)
  }
}

// Server-sent events -> the payload of each `data:` line.
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : ''
      if (data && data !== '[DONE]') yield data
    }
  }
}
