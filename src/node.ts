// Node entry point (`npm run dev`): node:sqlite for memory, node:http in front of the app.
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { text } from 'node:stream/consumers'
import { createApp, type App } from './app.ts'
import { openSqlite } from './sqlite.ts'

const port = Number(process.env.PORT) || 3000

let app: App
try {
  app = createApp(openSqlite(process.env.DB_PATH || 'remembot.db'), process.env)
} catch (err) {
  console.error(`\n  ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
}

createServer(async (req, res) => {
  try {
    const request = new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.method === 'POST' ? await text(req) : undefined,
    })
    const response = (await app(request)) ?? (await page(request))
    res.writeHead(response.status, Object.fromEntries(response.headers))
    // pipeline() cancels the response stream if the browser goes away mid-answer.
    if (response.body) await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), res)
    else res.end()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(err)
    res.destroy()
  }
}).listen(port, () => console.log(`\n  Remembot is running at http://localhost:${port}\n`))

// The UI is one page plus its icon. (On Cloudflare the platform serves public/.)
const STATIC: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
}
async function page(req: Request): Promise<Response> {
  const file = STATIC[new URL(req.url).pathname]
  if (!file) return new Response('Not found', { status: 404 })
  return new Response(await readFile(new URL(`../public/${file[0]}`, import.meta.url)), { headers: { 'content-type': file[1] } })
}
