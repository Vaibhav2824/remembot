# Remembot: design

The brief: answer fast, get things right, remember what was asked and when. Its three sample questions share one shape: **a time phrase, a past exchange, a fresh look at the web, a diff.** The design follows that shape.

## How it works

```
message -> recall (code, ~1 ms) -> model -> web_search([q1..q6]) in parallel -> model streams answer -> remember
           time windows + keywords          the one tool                        cited [n]              timestamp + cited sources
```

1. **Recall, in code** (`time.ts`, `memory.ts`). Time phrases become day windows. SQLite returns the exchanges inside them and the 12 most recent questions. If the named day holds nothing, the best keyword matches from other dates are offered instead (FTS5, BM25, stemmed).
2. **The model decides once** (`agent.ts`). It sees the clock, a 14-day calendar and that memory. It answers from memory, or sends one `web_search` call carrying a list of queries.
3. **The queries run in parallel** (`search.ts`). Results are numbered once per turn.
4. **The answer streams** with `[n]` citations, then is stored with its timestamp and only the sources it cited.

Measured on the default model: a memory-only answer starts in 0.3 s, small talk in 0.9 s, and a six-search re-check of five CRM prices in about 4 s (about 3 s of that is search).

## Why this way

- **Memory is context, not a tool.** The brief allows one tool. Recall in code also saves a model round trip on every message, and the model cannot forget to look.
- **Code does the calendar, the model does the language.** Models slip on weekday arithmetic; code does not. The model is handed dates to read and told never to compute them.
- **Ambiguity is kept, not guessed.** "Last Tuesday" said on a Thursday yields two candidate days; "3/11" yields 3 Nov and 11 Mar. Memory settles it, and the answer opens with the real date. A day with no history reaches the model as "no exchanges recorded", which is what stops it inventing a conversation.
- **Every answer is a dated snapshot.** "Is that still correct?" needs the old answer, its sources and its date. The model re-checks those facts and reports old value, new value, and what it could not verify.
- **Queries are a list, not parallel tool calls.** The default model emits one tool call per step. With one query per call it searched two products, ran out of steps and guessed the other two. A list argument works on every model.
- **A turn has a budget: 6 queries, 4 model calls.** After each search the model is told what is left; the last call has no tool, so every turn ends. This bounds latency and cost, and keeps one question inside free-tier rate limits.
- **Failure is said out loud.** A failed search goes to the model as "Search failed", so the answer says "unverified" instead of filling the gap. Rate-limit waits are shown in the UI.
- **The clock is injected** (`Deps.now`). Tests pin it, a request can carry `now` to replay a dated conversation, and the demo button replays three real questions at past dates. Time logic can be checked today instead of next week.
- **The interface shows the time model.** Memory is on screen, not hidden: 14 day bars and a dated timeline. Each answer leads; what was recalled and searched folds into one line above it, and a six-cell meter shows the search budget the turn spent. Messages and scrolling never animate: they happen on every send and every streamed token, where motion would only read as lag.
- **One file, one system.** The UI is plain HTML, CSS and JS with no build. Every colour, size, gap and duration is a token from `.interface-design/system.md`; it was checked with Hallmark's linter and axe-core (WCAG 2.2 AA, both themes, phone and desktop).
- **One codebase, two runtimes.** `app.ts` is a plain `Request -> Response` handler. `node.ts` (node:sqlite) and `worker.ts` (Cloudflare D1) are about 40 lines each and run the same SQL from one `schema.sql`.
- **Small on purpose.** About 900 lines of TypeScript and one HTML file for the UI, one runtime dependency (chrono-node, to spot date phrases), no framework, no build step.

## Considered and rejected

- **Memory as a second tool, or a router model choosing memories.** One more round trip per message, and date maths done by a model.
- **Embeddings.** An extra key and network call per message. Time windows, BM25 and an always-visible timeline cover a personal history. The ceiling (pure paraphrase of old turns) is marked in the code.
- **Always showing topic matches from other dates.** Built it, then removed it: next to the right exchange, a second dated one made the model quote the wrong date.
- **A `since` date filter on the tool.** Built it, then removed it: the model applied it to ordinary lookups and filtered out the pricing pages it needed. The period goes in the query text.
- **Scraping full pages.** Better on some pricing tables, seconds slower on every search.
- **Extracting structured "claims" after each answer.** An extra model call per turn, and lossy. The cited answer is the ground truth.
- **An agent framework.** The loop is 60 lines; a framework would hide the part being judged.
- **A React UI kit.** The scrubber, status island and search meter are ported from free React components as plain CSS and JS, so the UI stays one file with nothing to build.

## With another week

- An eval set of dated, multi-day conversations run through the replay clock, scored on date accuracy, recall hits and citation validity, then tuned by numbers instead of by feel.
- Let the model open one page when excerpts are too thin; cache searches for a few minutes so follow-ups cost nothing.
- A second recall pass when the model points at a turn it can only see in the timeline; embeddings and monthly summaries once histories get long.
- Real accounts (identity is a random per-browser id today), per-user rate limits, IANA time zones for DST.
