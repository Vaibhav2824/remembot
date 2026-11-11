# Asof: design

The brief: answer fast, get things right, remember what was asked and when. Its three sample questions share one shape: **a time phrase, a past exchange, a fresh look at the web, a diff.** The design follows that shape.

## How it works

```
message -> recall (code, ~1 ms) -> model -> web_search x N in parallel -> model streams answer -> remember
           time windows + keywords          the one tool                  cited [n]              timestamp + cited sources
```

1. **Recall, in code** (`time.ts`, `memory.ts`). Time phrases become day windows. SQLite returns the exchanges inside them, the best keyword matches from any date (FTS5, BM25, stemmed), and the 12 most recent questions.
2. **The model decides once** (`agent.ts`). It sees the clock, a 14-day calendar and that memory. It answers from memory, or asks for every search it needs in one step.
3. **Searches run in parallel** (`search.ts`). Results are numbered once per turn.
4. **The answer streams** with `[n]` citations, then is stored with its timestamp and only the sources it cited.

## Why this way

- **Memory is context, not a tool.** The brief allows one tool. Recall in code also saves a model round trip on every message, and the model cannot forget to look.
- **Code does the calendar, the model does the language.** Models slip on weekday arithmetic; code does not. The model is handed dates to read and told never to compute them.
- **Ambiguity is kept, not guessed.** "Last Tuesday" said on a Thursday yields two candidate days; "3/11" yields 3 Nov and 11 Mar. Memory settles it, and the answer names the real date. A window with no history is passed to the model as "no exchanges recorded", which is what stops it inventing a conversation.
- **Every answer is a dated snapshot.** "Is that still correct?" needs the old answer, its sources and its date. The model re-searches those facts (the tool takes a `since` date) and reports old value, new value, and what it could not verify.
- **Speed is structural.** Recall costs a millisecond, searches overlap, results are excerpts rather than pages so the second call stays small, and after two search rounds the model must answer. A memory-only question is a single model call.
- **The clock is injected** (`Deps.now`). Tests pin it, a request can carry `now` to replay a dated conversation, and the demo button replays three real questions at past dates. Time logic can be checked today instead of next week.
- **One codebase, two runtimes.** `app.ts` is a plain `Request -> Response` handler. `node.ts` (node:sqlite) and `worker.ts` (Cloudflare D1) are about 40 lines each and run the same SQL from one `schema.sql`.
- **Small on purpose.** About 900 lines, one runtime dependency (chrono-node, to spot date phrases), no framework, no build step. Every line is there to be read.

## Considered and rejected

- **Memory as a second tool, or a small router model choosing memories.** One more round trip per message, and date maths done by a model.
- **Embeddings.** An extra key and network call per message. Time window + BM25 + an always-visible recent timeline covers a personal history. The ceiling (pure paraphrase of old turns) is marked in the code.
- **Extracting structured "claims" after each answer.** An extra model call per turn, and lossy. The cited answer is the ground truth.
- **Scraping full pages.** Better on some pricing tables, seconds slower on every search.
- **Searching speculatively while the model thinks.** Wasted on memory-only questions, and the right queries need memory first (the five CRM names).
- **An agent framework.** The loop is 60 lines; a framework would hide the part being judged.

## With another week

- An eval set of dated, multi-day conversations run through the replay clock, scored on date accuracy, recall hits and citation validity, then tuned by numbers instead of by feel.
- Let the model open one page when excerpts are too thin.
- A second recall pass when the model points at a turn it can only see in the timeline; embeddings and monthly summaries once histories get long.
- Real accounts (identity is a random per-browser id today), per-user rate limits, IANA time zones for DST.
