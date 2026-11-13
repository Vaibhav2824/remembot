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
-- Reopening a saved chat reads one thread of one user.
CREATE INDEX IF NOT EXISTS turns_by_thread ON turns (user_id, thread_id, asked_at);

-- Accounts. `pass` is a PBKDF2-SHA256 hash with its own salt (see src/auth.ts), never the password.
CREATE TABLE IF NOT EXISTS users (
  id         TEXT    PRIMARY KEY,
  email      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  name       TEXT    NOT NULL,
  pass       TEXT    NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
-- Only the SHA-256 of a session token is stored: a leaked table cannot sign anyone in.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    TEXT    NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions (expires_at);
-- Rate-limit events: sign-ins, sign-ups and started turns, kept for a day.
CREATE TABLE IF NOT EXISTS auth_events (
  key TEXT    NOT NULL,
  at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_events_by_key ON auth_events (key, at);
CREATE INDEX IF NOT EXISTS auth_events_by_time ON auth_events (at);
