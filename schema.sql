-- One row per exchange. The same file initialises node:sqlite locally and D1 on Cloudflare.
CREATE TABLE IF NOT EXISTS turns (
  id        INTEGER PRIMARY KEY,
  user_id   TEXT    NOT NULL,
  thread_id TEXT    NOT NULL,
  asked_at  INTEGER NOT NULL,            -- epoch ms, UTC: when it was asked on the agent's clock
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), -- when the row was really written
  question  TEXT    NOT NULL,
  answer    TEXT    NOT NULL,
  sources   TEXT    NOT NULL DEFAULT '[]' -- JSON [{title,url}], the pages the answer cited
);
CREATE INDEX IF NOT EXISTS turns_by_time ON turns (user_id, asked_at);
-- Keyword recall. rowid = turns.id. Porter stemming so "pricing" finds "prices".
CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(question, answer, tokenize = 'porter unicode61');
