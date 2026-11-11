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

// Yields answer text as it arrives; returns the tool calls the model asked for (if any).
export type Chat = (messages: Msg[], tools?: object[]) => AsyncGenerator<string, ToolCall[]>

export interface LlmConfig {
  baseUrl: string
  apiKey: string
  model: string
  reasoningEffort?: string
}

const MAX_OUTPUT_TOKENS = 1500
const MAX_RATE_LIMIT_WAIT_S = 30

export function createChat(cfg: LlmConfig): Chat {
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
    }

    let res = await post(body)
    // Free tiers have tight per-minute budgets. One patient retry beats failing the turn.
    const retryAfter = Number(res.headers.get('retry-after'))
    if (res.status === 429 && retryAfter <= MAX_RATE_LIMIT_WAIT_S) {
      await new Promise((resolve) => setTimeout(resolve, (retryAfter || 1) * 1000))
      res = await post(body)
    }
    if (!res.ok || !res.body) throw new Error(`Model request failed (${res.status}): ${(await res.text()).slice(0, 300)}`)

    const calls: ToolCall[] = []
    for await (const data of sseData(res.body)) {
      const delta = JSON.parse(data).choices?.[0]?.delta
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
