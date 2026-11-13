// Cloudflare Workers entry point (`npm run deploy`): D1 for memory. Every request runs
// through here first (run_worker_first), so HTTPS and the security headers cover the
// static pages too; anything the app does not handle is served from public/.
import { createApp, withSecurityHeaders, type Env } from './app.ts'
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
  async fetch(req: Request, env: Env & { DB: D1; ASSETS: { fetch(req: Request): Promise<Response> } }): Promise<Response> {
    const url = new URL(req.url)
    if (url.protocol === 'http:') {
      url.protocol = 'https:'
      return Response.redirect(url.toString(), 301)
    }
    const app = createApp(d1(env.DB), env)
    return withSecurityHeaders((await app(req)) ?? (await env.ASSETS.fetch(req)), true)
  },
}
