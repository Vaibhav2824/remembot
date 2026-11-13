// Node entry point (`npm run dev`): node:sqlite for memory, node:http in front of the app.
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createApp, withSecurityHeaders, type App } from './app.ts'
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
    const headers = new Headers(req.headers as Record<string, string>)
    headers.set('cf-connecting-ip', req.socket.remoteAddress ?? 'unknown') // what Cloudflare sets; a client cannot spoof it here
    const request = new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), {
      method: req.method,
      headers,
      body: req.method === 'POST' || req.method === 'DELETE' ? await readCapped(req) : undefined,
    })
    const response = withSecurityHeaders((await app(request)) ?? (await page(request)), false)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    // pipeline() cancels the response stream if the browser goes away mid-answer.
    if (response.body) await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), res)
    else res.end()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error(err)
    res.destroy()
  }
}).listen(port, () => console.log(`\n  Remembot is running at http://localhost:${port}\n`))

// Stops reading past 64 KB, so a huge (or chunked, length-less) upload cannot fill memory.
// The app then refuses anything over its own 16 KB limit.
const MAX_UPLOAD = 65_536
async function readCapped(req: AsyncIterable<Buffer>): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_UPLOAD) break
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

// Static files from public/, the way Cloudflare serves them: /login -> login.html, unknown -> 404.html.
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url))
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}
async function page(req: Request): Promise<Response> {
  try {
    let path = decodeURIComponent(new URL(req.url).pathname)
    if (path.endsWith('/')) path += 'index.html'
    if (!extname(path)) path += '.html'
    const file = join(PUBLIC, path) // join() resolves "..", and the prefix check keeps it inside public/
    if (file.startsWith(PUBLIC) && TYPES[extname(file)]) return new Response(await readFile(file), { headers: { 'content-type': TYPES[extname(file)] } })
  } catch {
    // missing file or a malformed path: fall through to the 404 page
  }
  return new Response(await readFile(join(PUBLIC, '404.html')), { status: 404, headers: { 'content-type': TYPES['.html'] } })
}
