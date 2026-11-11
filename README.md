# Asof

A chat agent with one tool, web search, that remembers what you asked and when.
Built for the [minimi hiring challenge](https://app.notion.com/p/minimi-hiring-challenge-build-a-chat-agent-4100a8b933b181b98277d8ea5a534d6f). The reasoning is in [DESIGN.md](DESIGN.md).

## Run it

Needs Node 22.18 or newer (it uses Node's built-in SQLite and TypeScript support).

```bash
npm install
cp .env.example .env      # then fill in the two keys
npm run dev               # http://localhost:3000
```

Two keys, both with free tiers:

| Key | For | Get it |
| --- | --- | --- |
| `LLM_API_KEY` | the model (Groq, `openai/gpt-oss-120b`) | https://console.groq.com/keys |
| `FIRECRAWL_API_KEY` | web search | https://www.firecrawl.dev/app/api-keys |

Any OpenAI-compatible endpoint works: set `LLM_BASE_URL` and `LLM_MODEL` in `.env`.

Groq's free tier allows 8,000 tokens a minute on this model, roughly one searched answer a minute. The agent waits and retries once when it hits that limit, so it stays correct but gets slow. A paid Groq key removes the wait.

## Try the questions from the brief

A new install has no past. Click **Load demo memory**: it replays three real questions through the agent with the clock set to 3 November, last Monday and last Tuesday (live searches, real answers, backdated timestamps). Then ask:

- "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"
- "What did I ask you on 3 November? Is your answer still correct today?"
- "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"

Also worth trying: ask about a day with no history ("what did I ask last Friday?"). It should say it has no record, not make one up. **New chat** starts an empty conversation; memory carries over.

### Replaying your own dated conversation

With `ALLOW_TIME_TRAVEL=1` (the default in `.env.example`), a request can carry its own clock:

```bash
curl -N localhost:3000/api/chat -H 'content-type: application/json' -d '{
  "userId": "reviewer-01", "threadId": "thread-01", "tz": 330,
  "now": "2026-11-03T10:00:00+05:30",
  "message": "Which managed Postgres host is cheapest for a side project?"
}'
```

Send later messages with a later `now` (or none) and the agent treats the first one as having happened on 3 November. To see that user's memory in the UI, run `localStorage.setItem('asof-user', 'reviewer-01')` in the browser console and reload.

## Tests

```bash
npm test          # 33 tests, offline: time phrases, recall, the agent loop against a scripted model, the HTTP API
npm run typecheck
```

## Where things are

| File | Job |
| --- | --- |
| `src/agent.ts` | One turn: recall, model, parallel searches, streamed answer, remember |
| `src/time.ts` | Time phrases to candidate day windows |
| `src/memory.ts` | Store and recall exchanges (SQLite, FTS5) |
| `src/prompt.ts` | The rules and the per-message context the model sees |
| `src/search.ts` | The one tool: web search |
| `src/llm.ts` | Streaming chat completions client |
| `src/app.ts` | HTTP API as a `Request -> Response` handler |
| `src/node.ts`, `src/sqlite.ts` | Node entry point and node:sqlite adapter |
| `src/worker.ts` | Cloudflare Workers entry point and D1 adapter |
| `src/demo.ts` | Demo memory replay |
| `public/index.html` | The UI, one file, no build |
| `schema.sql` | The one table and its search index |

## Deploy to Cloudflare (optional)

```bash
npx wrangler d1 create asof                       # put the printed id in wrangler.jsonc
npx wrangler d1 execute asof --remote --file schema.sql
npx wrangler secret put LLM_API_KEY
npx wrangler secret put FIRECRAWL_API_KEY
npm run deploy
```
