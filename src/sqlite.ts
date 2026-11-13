// node:sqlite behind the Db interface. Node only; used by the dev server and the tests.
import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Db } from './memory.ts'

export function openSqlite(path: string): Db {
  const sqlite = new DatabaseSync(path)
  sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  return {
    async run(sql, ...params) {
      sqlite.prepare(sql).run(...(params as SQLInputValue[]))
    },
    async all<T>(sql: string, ...params: unknown[]) {
      return sqlite.prepare(sql).all(...(params as SQLInputValue[])) as T[]
    },
  }
}
