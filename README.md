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

Keys:

| Key | For | Get it |
| --- | --- | --- |
| `LLM_API_KEY` | the primary model (Groq, `openai/gpt-oss-120b`; the free tier works) | https://console.groq.com/keys |
| `FALLBACK_LLM_API_KEY` | optional backup (OpenAI, `gpt-6-luna`) | https://platform.openai.com/api-keys |
| `FIRECRAWL_API_KEY` | web search | https://www.firecrawl.dev/app/api-keys |

Any OpenAI-compatible endpoint works for either: set `LLM_BASE_URL`, `LLM_MODEL` and `LLM_REASONING_EFFORT` (or the `FALLBACK_LLM_*` versions) in `.env`.

**Speed and cost.** The first word arrives in about 1.5 to 2.5 s, search included:
- **Search starts immediately.** The question is searched while memory is recalled, so most answers take one model call.
- **Search skips the slow extras.** It runs without Firecrawl's highlights and domain-tool lookups, which tripled its latency.
- **The model is fast.** gpt-oss-120b on Groq streams its first token in about 0.5 s.

On Groq's free tier the model costs nothing. That tier allows 8,000 tokens a minute, about two answers a minute across all users. When Groq is rate-limited or down, the turn goes straight to OpenAI's `gpt-6-luna` on the fast tier: about $0.012 for a heavy turn, $0.10 / $0.50 per million tokens doubled. Groq's paid Developer plan raises the limit to 250k tokens a minute at $0.15 / $0.60. Spend is capped per account (`MAX_TURNS_PER_USER_PER_DAY`, 50 on the deployment) and in total (`MAX_TURNS_PER_DAY`). Firecrawl searches are billed in Firecrawl credits.

## Using it

- **Accounts.** `/` sends you to `/login` until you sign in. Create an account with a name, email and password (8+ characters); the password is stored as a salted PBKDF2-SHA256 hash and the session is an HttpOnly cookie. Sign-in locks for 15 minutes after 10 wrong passwords.
- **Welcome.** A new account sees "Create your first memory" with three starter questions that have moving parts (prices, events, rumours). A returning user sees "Welcome back" with a card per recent chat. Each card shows when it was saved, a short topic, and a "what has changed since?" question the model writes once per chat and caches. A card reopens that chat and asks its question there.
- **Light and dark.** The sun/moon switch beside the sidebar's collapse button (and on the sign-in page) changes theme with a circle that grows from the switch. The choice is remembered.
- **Saved chats.** Every chat is saved to your account and listed in the sidebar, newest activity first, grouped by day. Click one to reopen and continue it; its URL (`/?c=<id>`) can be bookmarked. Hover a chat and press the trash icon twice to delete it. The account menu (bottom left) has sign-out and **Delete account**, which erases everything after asking for your password.
- **Each answer leads.** Above it, one quiet line says what the agent did ("Recalled 3 exchanges, searched 3 times"); click it to see the memory windows and the exact queries. Citations like `1` link to the source, show its title on hover or focus, and the cited sources sit under the answer.
- **The readout line** under each answer gives the time, how long the first word and the whole answer took, and a six-cell meter of the searches used out of the 6 a message allows ("Answered from memory" when none).
- **The 14-day bars** above the chat list show how many chats were active each day: drag across them, or focus them and use the arrow keys, to jump the list to that day. Memory itself spans every chat of your account.
- **Collapse the panel** to a slim rail of icons with the button beside the name, or **Ctrl+B** (**Cmd+B** on a Mac); the rail brings it back. The choice is remembered. On a phone the panel is a drawer behind the menu button (Escape or a tap outside closes it).
- **A streaming answer is followed while you are at the bottom;** scroll up to read and it stops, showing **Latest**. Each finished answer has **Copy answer**.
- **The look** is calm and quiet: warm paper (or a warm dark theme, following your system), a serif greeting with the composer centred on an empty chat, answers set in a reading serif, and one accent. Motion ([Motion](https://motion.dev), vendored in `public/vendor/`) is springy and short: keys that sink when pressed, messages that settle in, a word-by-word greeting, a stack of dated questions on the sign-in page. All of it is off under "reduce motion". The brand kit (logo, colours, type, usage) is in [`brand/`](brand/README.md).

## Try the questions from the brief

A new install has no past. To give it one, replay three real questions with the clock set to 3 November, last Monday and last Tuesday (live searches, real answers, backdated timestamps). There is no button for this in the UI; while signed in, run this in the browser console, then reload:

```js
await (await fetch('/api/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tz: -new Date().getTimezoneOffset() }) })).text()
```

It takes about half a minute and uses ten searches, so on free keys give it a minute before asking:

- "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"
- "What did I ask you on 3 November? Is your answer still correct today?"
- "On Monday we shortlisted 5 CRM tools for a 20-person sales team. Has any of them changed pricing or shipped something big since?"

Also worth trying: ask about a day with no history ("what did I ask last Friday?"). It should say it has no record, not make one up. **New chat** starts an empty conversation; memory carries over.

### Replaying your own dated conversation

With `ALLOW_TIME_TRAVEL=1` (the default in `.env.example`), a request can carry its own clock. Signed in, from the browser console:

```js
await (await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
  threadId: 'thread-01', tz: 330, now: '2026-11-03T10:00:00+05:30',
  message: 'Which managed Postgres host is cheapest for a side project?' }) })).text()
```

Send later messages with a later `now` (or none) and the agent treats the first one as having happened on 3 November.

## Tests

```bash
npm test          # 48 tests, offline: time phrases, recall, the agent loop, accounts, sessions, rate limits, CSRF, saved chats
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
| `src/app.ts` | HTTP API as a `Request -> Response` handler, sign-in redirects, security headers |
| `src/auth.ts` | Password hashing, sessions, rate limiting (Web Crypto, runs on both runtimes) |
| `src/node.ts`, `src/sqlite.ts` | Node entry point and node:sqlite adapter |
| `src/worker.ts` | Cloudflare Workers entry point and D1 adapter |
| `src/demo.ts` | Demo memory replay |
| `public/index.html`, `public/app.js` | The chat UI: no framework, no build |
| `public/login.html`, `public/auth.js` | Sign in and create account, with the landing copy and FAQ |
| `public/base.css` | Shared tokens and components (keys, fields, consent banner) |
| `public/consent.js` | Cookie consent; loads Cloudflare Web Analytics only after "Accept all" (paste your token at the top) |
| `public/privacy.html`, `terms.html`, `404.html` | Legal pages and the not-found page |
| `public/robots.txt`, `sitemap.xml`, `og.png` | Crawling and the social preview image |
| `brand/` | Logo (Strata), lockups, icon set, colours, type and usage guide |
| `schema.sql` | Turns and their search index; users, sessions, sign-in events |

## Deploy to Cloudflare (optional)

```bash
npx wrangler d1 create asof                           # put the printed id in wrangler.jsonc
npx wrangler d1 execute asof --remote --file schema.sql   # again after every schema.sql change
npx wrangler secret put LLM_API_KEY
npx wrangler secret put FIRECRAWL_API_KEY
npm run deploy
```
