// Accounts and sessions on Web Crypto alone, so the same code runs on Node and on Workers.
// Passwords: PBKDF2-SHA256 with a per-user salt. Sessions: a random token in an HttpOnly
// cookie; only its SHA-256 is stored.
import type { Db } from './memory.ts'

export interface User {
  id: string
  email: string
  name: string
}

const ITERATIONS = 100_000 // the most PBKDF2 iterations Cloudflare Workers allows
const SESSION_DAYS = 30
const DAY = 86_400_000
const COOKIE = 'sid'

const enc = new TextEncoder()
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
const sha256 = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('')

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256))
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `pbkdf2-sha256$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split('$')
  if (scheme !== 'pbkdf2-sha256' || !salt || !hash) return false
  const actual = await pbkdf2(password, unb64(salt), Number(iterations))
  const expected = unb64(hash)
  let diff = actual.length ^ expected.length // constant time: never return early on a mismatch
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ (expected[i] ?? 0)
  return diff === 0
}

// Checked against when the email is unknown, so a miss takes as long as a wrong password.
let dummy: Promise<string> | undefined
export const dummyHash = () => (dummy ??= hashPassword('not-a-real-password'))

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  await db.run('DELETE FROM sessions WHERE expires_at < ?', Date.now())
  await db.run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', await sha256(token), userId, Date.now() + SESSION_DAYS * DAY)
  return token
}

export async function sessionUser(db: Db, req: Request): Promise<User | null> {
  const token = readCookie(req, COOKIE)
  if (!token) return null
  const [user] = await db.all<User>(
    'SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
    await sha256(token),
    Date.now(),
  )
  return user ?? null
}

export async function endSession(db: Db, req: Request): Promise<void> {
  const token = readCookie(req, COOKIE)
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', await sha256(token))
}

// HttpOnly: page scripts cannot read it. SameSite=Lax: other sites cannot send it with a POST.
export function sessionCookie(token: string | null, secure: boolean): string {
  return [`${COOKIE}=${token ?? ''}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${token ? SESSION_DAYS * 86_400 : 0}`, ...(secure ? ['Secure'] : [])].join('; ')
}

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=') || undefined
  }
}

// Rate limiting by key ("login:a@b.c", "ip:1.2.3.4", "turn:<user>"). The attempt is recorded
// before it is counted, so a burst of parallel requests cannot all slip under the limit.
// Windows are at most a day: older events are cleared.
export async function overLimit(db: Db, key: string, limit: number, windowMs: number): Promise<boolean> {
  await db.run('DELETE FROM auth_events WHERE at < ?', Date.now() - DAY)
  await db.run('INSERT INTO auth_events (key, at) VALUES (?, ?)', key, Date.now())
  const [{ n }] = await db.all<{ n: number }>('SELECT count(*) AS n FROM auth_events WHERE key = ? AND at > ?', key, Date.now() - windowMs)
  return n > limit
}
