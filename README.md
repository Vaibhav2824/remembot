<a id="readme-top"></a>

<div align="center">
  <a href="https://remembot.asof-agent.workers.dev">
    <img src="public/favicon.svg" alt="Remembot" width="72" height="72">
  </a>

  <h1 align="center">Remembot</h1>

  <p align="center">
    A chat agent with one tool, web search, that remembers what you asked and when.
    <br />
    Ask anything. Ask again next week, and it tells you what changed.
    <br />
    <br />
    <a href="https://remembot.asof-agent.workers.dev"><strong>Try it live (Continue as guest, no sign-up) »</strong></a>
    <br />
    <br />
    <a href="docs/media/demo.mp4">Watch the demo</a>
    &middot;
    <a href="DESIGN.md">Read the design</a>
    &middot;
    <a href="https://github.com/Vaibhav2824/remembot/issues/new?labels=bug">Report a bug</a>
  </p>

  [![Cloudflare Workers][workers-shield]][workers-url]
  [![TypeScript][ts-shield]][ts-url]
  [![Node 22][node-shield]][node-url]
  [![Tests][tests-shield]](#tests)
</div>

<details>
  <summary>Table of contents</summary>
  <ol>
    <li><a href="#about-the-project">About the project</a>
      <ul><li><a href="#built-with">Built with</a></li></ul>
    </li>
    <li><a href="#getting-started">Getting started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#deploy-to-cloudflare">Deploy to Cloudflare</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage</a></li>
    <li><a href="#project-structure">Project structure</a></li>
    <li><a href="#tests">Tests</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About the project

<a href="docs/media/demo.mp4"><img src="docs/media/demo.webp" alt="Remembot in 60 seconds: recall in code, one model decision, parallel search, a cited answer, a budget so every turn ends" width="100%"></a>

<sub>60-second tour. Click it for the full video with sound (<a href="docs/media/demo.mp4">MP4, 3 MB</a>).</sub>

Most chat agents forget you the moment the tab closes. Remembot keeps every question with the date and time you asked it, so "What did I ask last Tuesday? Is that still right?" has a real answer:

- **It remembers when.** "Last Tuesday", "on 3 Nov" or "since Monday" are resolved in code to real days, and the matching exchanges are put in front of the model with their dates.
- **It checks the live web.** Answers come from Firecrawl search with numbered citations. A re-check reports the old value, the new value, and what it could not verify.
- **It is fast.** The first word arrives in about 1.5 s: memory and a search run in parallel, then Groq's `gpt-oss-120b` streams the answer. OpenAI's `gpt-6-luna` takes over instantly if Groq is rate-limited or down.
- **It is a real product:**
  - Accounts, or one-click guest sessions.
  - Saved chats, light and dark themes.
  - Privacy and terms pages, a cookie choice, rate limits.
  - Security headers on every response, and 48 offline tests.

How it works, with diagrams of the architecture, one turn, the agent loop, memory recall and the data model: **[DESIGN.md](DESIGN.md)**.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built with

[![Cloudflare Workers][workers-shield]][workers-url] [![D1][d1-shield]][d1-url] [![TypeScript][ts-shield]][ts-url] [![Groq][groq-shield]][groq-url] [![OpenAI][openai-shield]][openai-url] [![Firecrawl][firecrawl-shield]][firecrawl-url] [![Motion][motion-shield]][motion-url]

- **No framework and no build step.** The UI is plain HTML, CSS and JS. Motion is vendored as one file.
- **One runtime dependency,** [`chrono-node`](https://github.com/wanasit/chrono), to spot date phrases.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting started

### Prerequisites

- Node.js 22.18 or newer (it uses Node's built-in SQLite and TypeScript support).
- Two keys, with an optional third:

| Key | For | Get it |
| --- | --- | --- |
| `LLM_API_KEY` | the primary model (Groq, `openai/gpt-oss-120b`; the free tier works) | https://console.groq.com/keys |
| `FIRECRAWL_API_KEY` | web search | https://www.firecrawl.dev/app/api-keys |
| `FALLBACK_LLM_API_KEY` | optional backup (OpenAI, `gpt-6-luna`) | https://platform.openai.com/api-keys |

### Installation

1. Clone the repo and install:
   ```sh
   git clone https://github.com/Vaibhav2824/remembot.git
   cd remembot
   npm install
   ```
2. Copy the example settings, then fill in the keys:
   ```sh
   cp .env.example .env
   ```
3. Run it at http://localhost:3000:
   ```sh
   npm run dev
   ```

Any OpenAI-compatible endpoint works for either model: set `LLM_BASE_URL`, `LLM_MODEL` and `LLM_REASONING_EFFORT`, or their `FALLBACK_LLM_*` versions.

**Cost.**
- **Groq:** the model costs nothing on Groq's free tier (8,000 tokens a minute, about two answers a minute site-wide).
- **OpenAI:** when it covers for Groq, a heavy turn costs about $0.012.
- **Caps:** spend is capped per account (`MAX_TURNS_PER_USER_PER_DAY`) and in total (`MAX_TURNS_PER_DAY`).
- **Firecrawl:** searches are billed in Firecrawl credits.

### Deploy to Cloudflare

1. Create the database once, and put the printed id in `wrangler.jsonc`:
   ```sh
   npx wrangler d1 create asof
   ```
2. Create or update the tables, again after every `db/schema.sql` change:
   ```sh
   npm run db:migrate
   ```
3. Store the keys as secrets:
   ```sh
   npx wrangler secret put LLM_API_KEY
   ```
   ```sh
   npx wrangler secret put FALLBACK_LLM_API_KEY
   ```
   ```sh
   npx wrangler secret put FIRECRAWL_API_KEY
   ```
4. Deploy:
   ```sh
   npm run deploy
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

- **Sign in, create an account, or Continue as guest.**
  - **Accounts:** the password is stored as a salted PBKDF2-SHA256 hash, and the session is an HttpOnly cookie.
  - **Guests:** one click opens the app. Ending the session deletes the guest account and its chats.
- **First visit:** "Create your first memory" offers three starter questions with moving parts (a price, an event, a rumour).
- **Returning:** "Welcome back" shows a card per recent chat with a "what has changed since?" question. A card reopens that chat and asks it there.
- **Saved chats** sit in the sidebar, grouped by day.
  - **Reopen:** click one to continue it; `/?c=<id>` links straight to it.
  - **Delete:** hover a chat and press the trash icon twice.
  - **The 14-day bars** jump the list to a day.
- **Each answer leads.** One quiet line above it says what was recalled and searched; open it for the details. Citations link to their sources.
- **Light or dark:** the sun/moon switch is beside the sidebar's collapse button. **Ctrl+B** (**Cmd+B** on a Mac) collapses the sidebar.

**Try the "ask again" side.** A new account has no past. To give it one, run this in the browser console while signed in, then reload. It replays three real questions at 3 November, last Monday and last Tuesday, using live searches and real answers with backdated timestamps:

```js
await (await fetch('/api/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tz: -new Date().getTimezoneOffset() }) })).text()
```

Then ask:
- "Last Tuesday I asked you about Postgres hosting. Has any pricing changed since then?"
- "What did I ask you on 3 November? Is your answer still correct today?"

With `ALLOW_TIME_TRAVEL=1`, a request to `/api/chat` can also carry its own clock (`"now": "2026-11-03T10:00:00+05:30"`) to replay a dated conversation.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Project structure

```text
remembot/
├── DESIGN.md              how and why it works, with diagrams
├── README.md
├── src/                   the server (TypeScript, runs on Node and on Workers)
│   ├── app.ts             HTTP API as Request -> Response: auth, CSRF, rate limits, headers
│   ├── agent.ts           one turn: recall + pre-search, model, parallel searches, remember
│   ├── auth.ts            password hashing, sessions, rate-limit events (Web Crypto)
│   ├── llm.ts             streaming chat client with instant provider fallback
│   ├── memory.ts          store and recall exchanges (SQLite, FTS5), saved chats
│   ├── prompt.ts          the rules and the per-message context the model sees
│   ├── search.ts          the one tool: Firecrawl web search
│   ├── suggest.ts         returning-user cards, written once per chat and cached
│   ├── time.ts            time phrases -> candidate day windows
│   ├── demo.ts            replay of three dated questions
│   ├── node.ts, sqlite.ts Node entry point, node:sqlite adapter, static files
│   └── worker.ts          Cloudflare entry point, D1 adapter, HTTPS redirect
├── public/                the UI: no framework, no build
│   ├── index.html, app.js the chat app
│   ├── login.html, auth.js sign-in, sign-up and guest; landing, demo, FAQ
│   ├── base.css, theme.js tokens, light and dark, the theme switch
│   ├── privacy.html, terms.html, 404.html, robots.txt, sitemap.xml
│   └── vendor/motion.js   Motion, vendored
├── db/schema.sql          one schema for SQLite locally and D1 in production
├── test/                  48 offline tests (node:test)
├── docs/
│   ├── diagrams/          the DESIGN.md diagrams, plus build.py that draws them
│   ├── media/             the demo video and its animated preview
│   └── brand/             logo (Strata), lockups, icons, colours, usage
├── wrangler.jsonc         Cloudflare config: Worker, assets, D1, model settings
└── .env.example           every setting, documented
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Tests

Run the suite:

```sh
npm test
```

Then the typecheck:

```sh
npm run typecheck
```

48 tests, all offline:
- time phrases and recall
- the agent loop against a scripted model, with pre-search and fallback
- accounts, guest sessions and sessions
- rate limits and parallel bursts, and CSRF
- per-user isolation of saved chats
- returning-user cards and their dates

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Accounts, guest sessions and saved chats
- [x] Groq first, OpenAI fallback, parallel pre-search (first word ~1.5 s)
- [x] Launch checklist: legal pages, consent, SEO, security headers, 404
- [ ] An eval set of dated multi-day conversations, scored on date accuracy and citations
- [ ] Purge idle guest accounts; seed new guests with one dated exchange
- [ ] Open one page when search excerpts are too thin; cache searches for follow-ups
- [ ] IANA time zones for daylight-saving accuracy

See the [open issues](https://github.com/Vaibhav2824/remembot/issues) for more.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Suggestions and fixes are welcome.

1. Fork the project.
2. Create a branch:
   ```sh
   git checkout -b feature/your-change
   ```
3. Make sure `npm test` and `npm run typecheck` pass.
4. Commit:
   ```sh
   git commit -m "feat: your change"
   ```
5. Push, then open a pull request:
   ```sh
   git push origin feature/your-change
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

No license has been chosen yet, so all rights are reserved by the author. Open an issue if you would like to use the code.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

Vaibhav, on GitHub: [@Vaibhav2824](https://github.com/Vaibhav2824)

- **Project:** https://github.com/Vaibhav2824/remembot
- **Live:** https://remembot.asof-agent.workers.dev

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

- **[Best-README-Template](https://github.com/othneildrew/Best-README-Template):** the shape of this README.
- **[diagram-design](https://github.com/cathrynlavery/diagram-design):** the grammar of the DESIGN.md diagrams.
- **[Motion](https://motion.dev):** the springs and loaders.
- **[SmoothUI](https://smoothui.dev), [tactileui](https://tactileui.dev) and [Stageshow](https://github.com/benjitaylor/skills):** button, toggle and demo patterns.
- **[Collect UI](https://collectui.com):** the sign-in layout, after Dima Kazarov's "Wafer".
- **J. M. W. Turner, *Fishing Boats Becalmed off le Havre*:** public domain, via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Joseph_Mallord_William_Turner_-_Fishing_Boats_Becalmed_off_le_Havre_-_Google_Art_Project.jpg).
- **[Groq](https://groq.com), [OpenAI](https://openai.com), [Firecrawl](https://firecrawl.dev) and [Cloudflare](https://workers.cloudflare.com).**

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[workers-shield]: https://img.shields.io/badge/Cloudflare_Workers-F38020?style=for-the-badge&logo=cloudflareworkers&logoColor=white
[workers-url]: https://workers.cloudflare.com
[d1-shield]: https://img.shields.io/badge/D1_SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white
[d1-url]: https://developers.cloudflare.com/d1/
[ts-shield]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[ts-url]: https://www.typescriptlang.org
[node-shield]: https://img.shields.io/badge/Node-22.18+-5FA04E?style=for-the-badge&logo=nodedotjs&logoColor=white
[node-url]: https://nodejs.org
[tests-shield]: https://img.shields.io/badge/tests-48_passing-0D9488?style=for-the-badge
[groq-shield]: https://img.shields.io/badge/Groq-gpt--oss--120b-F55036?style=for-the-badge
[groq-url]: https://groq.com
[openai-shield]: https://img.shields.io/badge/OpenAI-fallback-412991?style=for-the-badge&logo=openai&logoColor=white
[openai-url]: https://platform.openai.com
[firecrawl-shield]: https://img.shields.io/badge/Firecrawl-search-FF6B35?style=for-the-badge
[firecrawl-url]: https://firecrawl.dev
[motion-shield]: https://img.shields.io/badge/Motion-vendored-111111?style=for-the-badge
[motion-url]: https://motion.dev
