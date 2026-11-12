# Remembot

A chat agent with one tool, web search, that remembers what you asked and when.
**Live demo:** https://remembot.asof-agent.workers.dev (runs on my free-tier keys, so it can be slow or capped; local is the real thing)

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

**Free-tier limits.** Groq's free tier allows 8,000 tokens a minute on this model, which is about one searched answer a minute, and the Firecrawl plan I tested on allowed about 10 searches a minute. One question always fits. Ask several quickly and the agent waits for the model (the UI says "retrying in N s") or reports a search as failed and marks that fact unverified. Paid keys remove both.

## Using it

- **Each answer leads.** Above it, one quiet line says what the agent did ("Recalled 3 exchanges, searched 3 times"); click it to see the memory windows and the exact queries. Citations like `1` link to the source, show its title on hover or focus, and the cited sources sit under the answer.
- **The readout line** under each answer gives the time, how long the first word and the whole answer took, and a six-cell meter of the searches used out of the 6 a message allows ("Answered from memory" when none).
- **Memory is the left panel.** The 14-day bars show how many questions you asked each day: drag across them, or focus them and use the arrow keys, to jump the timeline to that day. Open a timeline row to read the stored answer and its sources.
- **On a phone** the panel becomes a drawer behind the **Memory** button (Escape or a tap outside closes it).
- **Scrolling is smoothed (Lenis).** A streaming answer is followed while you are at the bottom; scroll up to read and it stops, showing **Jump to latest**. Each finished answer has **Copy answer**.
- Light and dark follow your system setting. With reduced motion on, the animations, smooth scrolling and the welcome background are switched off.

## Try the questions from the brief

A new install has no past. Click **Load demo memory**: it replays three real questions through the agent with the clock set to 3 November, last Monday and last Tuesday (live searches, real answers, backdated timestamps). It takes about half a minute and uses ten searches, so on free keys give it a minute before asking:

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

Send later messages with a later `now` (or none) and the agent treats the first one as having happened on 3 November. To see that user's memory in the UI, run `localStorage.setItem('remembot-user', 'reviewer-01')` in the browser console and reload.

## Tests

```bash
npm test          # 36 tests, offline: time phrases, recall, the agent loop against a scripted model, the HTTP API
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
| `public/index.html` | The UI: one file of HTML, CSS and JS, no framework, no build |
| `.interface-design/system.md` | The UI's design system: colour, type, spacing and motion tokens, and the rules for each component |
| `schema.sql` | The one table and its search index |

## Deploy to Cloudflare (optional)

```bash
npx wrangler d1 create remembot                       # put the printed id in wrangler.jsonc
npx wrangler d1 execute remembot --remote --file schema.sql
npx wrangler secret put LLM_API_KEY
npx wrangler secret put FIRECRAWL_API_KEY
npm run deploy
```
