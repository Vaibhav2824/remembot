// Cloudflare Workers entry point (`npm run deploy`): D1 for memory. The UI in
// public/ is served by the platform's static assets, so only /api/* reaches this code.
import { createApp, type Env } from './app.ts'
import type { Db } from './memory.ts'

// The slice of the D1 API this app uses.
interface D1 {
  prepare(sql: string): { bind(...params: unknown[]): { all<T>(): Promise<{ results: T[] }> } }
}

const d1 = (database: D1): Db => ({
  async run(sql, ...params) {
    await database.prepare(sql).bind(...params).all()
  },
  async all<T>(sql: string, ...params: unknown[]) {
    return (await database.prepare(sql).bind(...params).all<T>()).results
  },
})

export default {
  async fetch(req: Request, env: Env & { DB: D1 }): Promise<Response> {
    const app = createApp(d1(env.DB), env)
    return (await app(req)) ?? new Response('Not found', { status: 404 })
  },
}
