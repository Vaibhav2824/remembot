// The chat app. Identity comes from the session cookie; every chat is saved server-side
// and listed in the sidebar, newest activity first. /?c=<id> opens a saved chat.
const $ = (id) => document.getElementById(id)
const chat = $('thread'), scroller = $('chat'), main = $('main'), input = $('input'), sendBtn = $('send'), island = $('island')
const M = window.Motion
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
// Never lets an animation hold up logic: hidden tabs may not run it to the end.
const animate = (el, kf, opts) => (M && !calm && el ? Promise.race([M.animate(el, kf, opts), new Promise((r) => setTimeout(r, 800))]) : Promise.resolve())
const spring = { type: 'spring', stiffness: 420, damping: 32 }

let threadId = crypto.randomUUID()
let threads = []
const tz = -new Date().getTimezoneOffset()
let busy = null // AbortController while a reply is streaming
const MAX_CHARS = 2000

// Starters work on day one; the last one appears only once there is a past to ask about.
// A first-time user gets questions with moving parts, so next week has something to compare.
const STARTERS = [
  ['tag', 'Price tracking', 'Are there any active deals or discount codes for the Apple MacBook Air today?'],
  ['ticket', 'Event highlights', 'What is the current Coachella 2027 lineup, and are passes still on sale?'],
  ['gamepad', 'Industry rumors', 'What are the latest release-date and spec rumors for the next Nintendo console?'],
]
const MARK = '<svg class="mark live-mark" viewBox="0 0 256 256" aria-hidden="true"><g fill="currentColor"><rect class="m-bar" x="20" y="24" width="216" height="56" rx="28"/><rect class="m-bar" x="20" y="100" width="168" height="56" rx="28"/><rect class="m-bar" x="20" y="176" width="96" height="56" rx="28"/></g><circle class="m-dot" cx="207" cy="204" r="29"/></svg>'
const DOTS = '<span class="dots" aria-label="Thinking"><i></i><i></i><i></i></span>'
let me = null

// "Saved today", "Saved yesterday", "Saved last Tuesday", "Saved 10 days ago".
function savedAgo(ms) {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / DAY)
  if (days <= 0) return 'Saved today'
  if (days === 1) return 'Saved yesterday'
  if (days < 7) return `Saved last ${new Date(ms).toLocaleDateString('en-GB', { weekday: 'long' })}`
  return `Saved ${days} days ago`
}

// Motion's "pulse dots" loader: each dot swells in turn.
function pulse(root) {
  if (M && !calm) M.animate(root.querySelectorAll('.dots i'), { scale: [1, 1.5, 1] }, { duration: 1.2, repeat: Infinity, delay: M.stagger(0.2), ease: 'easeInOut' })
}

// SmoothUI's icon swap: the old icon blurs out upward, the new one blurs in from below.
async function swapIcon(btn, html) {
  if (!M || calm) { btn.innerHTML = html; return }
  await animate(btn.firstElementChild, { opacity: 0, y: -8, filter: 'blur(6px)' }, { type: 'spring', bounce: 0, duration: 0.2 })
  btn.innerHTML = html
  animate(btn.firstElementChild, { opacity: [0, 1], y: [8, 0], filter: ['blur(6px)', 'blur(0px)'] }, { type: 'spring', bounce: 0, duration: 0.25 })
}

// SmoothUI's magnetic button: within 150 px it leans toward the pointer (strength 0.3), on a soft spring.
function magnetic(el) {
  if (!M || calm || !matchMedia('(hover: hover) and (pointer: fine)').matches) return
  const to = (x, y) => M.animate(el, { x, y }, { type: 'spring', bounce: 0.1, duration: 0.4 })
  addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2)
    const d = Math.hypot(dx, dy), f = d < 150 ? 1 - d / 150 : 0
    to(dx * 0.3 * f, dy * 0.3 * f)
  }, { passive: true })
}

// The mark draws itself: bars from the left, then the dot, now.
function drawMark(svg) {
  if (!M || calm || !svg) return
  animate(svg.querySelectorAll('.m-bar'), { scaleX: [0, 1], originX: 0 }, { delay: M.stagger(0.09), type: 'spring', stiffness: 220, damping: 22 })
  animate(svg.querySelector('.m-dot'), { scale: [0, 1] }, { delay: 0.32, type: 'spring', stiffness: 500, damping: 14 })
}

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? esc(u) : '#')
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`
const link = (href, inner, attrs = '') => `<a ${attrs} href="${href}" target="_blank" rel="noopener noreferrer">${inner}</a>`
const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const dayOf = (ms) => new Date(ms).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA') // YYYY-MM-DD, local
const DAY = 86_400_000
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

// Every API call: JSON in and out; a lost session goes back to the sign-in page.
async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...opts.headers } })
  if (res.status === 401) { location.replace('/login'); throw new Error('Signed out') }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

function tactile(els) {
  if (!M || calm) return
  M.press(els, (el) => {
    M.animate(el, { scale: 0.97 }, { type: 'spring', stiffness: 900, damping: 30 }) // SmoothUI's press depth
    return () => M.animate(el, { scale: 1 }, { type: 'spring', stiffness: 500, damping: 18 })
  })
}

// Minimal, escape-first markdown: everything is escaped, then a few safe patterns are turned back into tags.
function markdown(text, sources) {
  text = text.replace(/【(\d+)[^】]*】/g, '[$1]').replace(/(\[\d+\])(?:\s*\1)+/g, '$1') // some models cite as 【1†L2-L5】, twice
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+?)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)\[\]<>\"]+)\)/g, (_, label, url) => link(url, label))
    .replace(/\[(\d+)\]/g, (_, n) => { const s = sources[n - 1]; return s ? link(safeUrl(s.url), n, `class="cite" data-tip="${esc(s.title)}&#10;${esc(host(s.url))}"`) : '' })
  const out = []
  let items = []
  const flush = () => { if (items.length) out.push(`<ul>${items.join('')}</ul>`); items = [] }
  for (const line of text.split('\n')) {
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)/)
    if (bullet) items.push(`<li>${inline(bullet[1])}</li>`)
    else { flush(); if (line.trim()) out.push(`<p>${inline(line.replace(/^#+\s*/, ''))}</p>`) }
  }
  flush()
  return out.join('')
}

// Follow the stream only while the reader is at the bottom; scrolling up stops it and offers a way back.
let pinned = true, lastTop = 0
const latest = $('latest')
const atBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
scroller.addEventListener('scroll', () => {
  if (atBottom()) { pinned = true; latest.hidden = true }
  else if (scroller.scrollTop < lastTop) pinned = false // only an upward scroll unpins; the stream itself only scrolls down
  lastTop = scroller.scrollTop
}, { passive: true })
function scrollDown(force = false) {
  if (force) pinned = true
  if (!pinned) { latest.hidden = false; return }
  scroller.scrollTop = scroller.scrollHeight
}
latest.addEventListener('click', () => { latest.hidden = true; scrollDown(true) })

// Scroll-spy: as the chat list scrolls, the scrubber marks the day at the top of the list.
$('timeline').addEventListener('scroll', () => {
  const top = $('timeline').getBoundingClientRect().top + 24
  let current = null
  for (const d of document.querySelectorAll('#timeline-list .day')) { if (d.getBoundingClientRect().top <= top) current = d.id.slice(2); else break }
  for (const c of $('days').children) c.classList.toggle('spy', c.dataset.day === current)
}, { passive: true })

// ---------- messages ----------
function addMessage(role, text = '', enter = true) {
  const el = document.createElement('article')
  el.className = `msg ${role}`
  el.innerHTML = role === 'user'
    ? `<div class="body"></div>`
    : `<details class="trace" hidden><summary></summary><ol></ol></details><div class="body"></div><ul class="sources"></ul><div class="meta mono"></div>`
  el.querySelector('.body').textContent = text
  chat.append(el)
  if (enter) animate(el, role === 'user' ? { opacity: [0, 1], y: [12, 0], scale: [0.97, 1] } : { opacity: [0, 1] }, role === 'user' ? spring : { duration: 0.3 })
  scrollDown()
  return el
}

// Sources chips and the readout line under a finished answer, live or reopened from memory.
function finish(el, answer, sources, parts) {
  const shown = el.querySelector('.body').innerHTML // rendered, so 【n†…】 citations are already normalised to [n] links
  const cited = sources.filter((s) => shown.includes(`>${s.n}</a>`))
  el.querySelector('.sources').innerHTML = cited.map((s) => `<li>${link(safeUrl(s.url),
    `<b>${s.n}</b><img src="https://icons.duckduckgo.com/ip3/${esc(host(s.url))}.ico" alt="" width="14" height="14" loading="lazy" decoding="async"><span>${esc(s.title)}</span>`,
    `title="${esc(s.title)}"`)}</li>`).join('')
  const meta = el.querySelector('.meta')
  const idle = `<span class="copy-in">${icon('copy')}Copy answer</span>`
  meta.innerHTML = parts.map((s) => `<span>${s}</span>`).join('') + `<button type="button" class="copy">${idle}</button>`
  const copy = meta.querySelector('.copy')
  copy.addEventListener('click', () => navigator.clipboard?.writeText(answer).then(async () => {
    await swapIcon(copy, `<span class="copy-in done">${icon('check')}Copied</span>`)
    setTimeout(() => swapIcon(copy, idle), 2000)
  }))
}
// A favicon that fails to load is removed (no inline handler: the CSP forbids them).
chat.addEventListener('error', (e) => { if (e.target.matches?.('.sources img')) e.target.remove() }, true)

// Two welcomes. First time: "Create your first memory" with starter questions. Returning: "Welcome
// back" with a card per recent chat asking what has changed since (written by the server, cached).
function welcome() {
  main.classList.add('empty')
  const returning = threads.length > 0
  const words = (s) => s.split(' ').map((w) => `<span>${esc(w)}</span>`).join(' ')
  chat.innerHTML = `<section class="welcome">
    <div class="greet">${MARK}<h2>${words(returning ? 'Welcome back.' : 'Create your first memory.')}</h2></div>
    <p class="sub">${returning ? 'Ask what has changed since last time' : 'Ask something with moving parts today, so you can see what’s changed next week.'}</p>
    <ul class="cards" id="cards" aria-label="${returning ? 'Pick up a saved chat' : 'Try one'}">${returning
      ? '<li><div class="card skel" aria-hidden="true"><span class="sk" style="width:45%"></span><span class="sk" style="width:85%"></span><span class="sk" style="width:65%"></span></div></li>'.repeat(Math.min(3, threads.length))
      : STARTERS.map(([ic, label, q]) => `<li><button type="button" class="card" data-q="${esc(q)}"><span class="pill">${icon(ic)}${esc(label)}</span><span class="q">${esc(q)}</span></button></li>`).join('')}</ul>
  </section>`
  scroller.scrollTop = 0
  if (M && !calm) {
    drawMark(chat.querySelector('.mark'))
    animate(chat.querySelectorAll('.welcome h2, .welcome .sub'), { opacity: [0, 1], y: [6, 0] }, { delay: M.stagger(0.08), duration: 0.35, ease: [0.2, 0, 0, 1] })
  }
  cardsIn()
  if (returning) savedCards()
}

function cardsIn() {
  const cards = chat.querySelectorAll('#cards .card')
  tactile([...cards].filter((c) => c.tagName === 'BUTTON'))
  animate(cards, { opacity: [0, 1], y: [12, 0] }, { delay: M?.stagger(0.07, { startDelay: 0.25 }), ...spring })
}

async function savedCards() {
  let list
  try {
    list = await api(`/api/suggestions?tz=${tz}`)
  } catch {
    list = threads.slice(0, 3).map((t) => ({ threadId: t.id, updatedAt: t.updatedAt, topic: t.title.split(' ').slice(0, 4).join(' '), followup: 'What has changed since I last asked about this?' }))
  }
  const box = $('cards')
  if (!box || !main.classList.contains('empty')) return // the user moved on while these loaded
  box.innerHTML = list.map((s) => `<li><button type="button" class="card saved" data-thread="${esc(s.threadId)}" data-q="${esc(s.followup)}">
    <span class="tag recall">${icon('memory')}${esc(savedAgo(s.updatedAt))}</span><span class="pill">${esc(s.topic)}</span><span class="q">${esc(s.followup)}</span></button></li>`).join('')
  cardsIn()
}

// A starter asks in a new chat; a saved card reopens its chat and asks the follow-up there, so memory has the thread.
chat.addEventListener('click', async (e) => {
  const card = e.target.closest('#cards button.card')
  if (!card) return
  if (card.dataset.thread) await openChat(card.dataset.thread)
  send(card.dataset.q)
})

let islandTimer = 0
function status(text, kind = '') {
  clearTimeout(islandTimer)
  if (!text) { island.classList.remove('on'); return }
  island.className = `on ${kind}`
  island.querySelector('span').textContent = text
  if (kind === 'error') islandTimer = setTimeout(() => status(''), 6000)
}

// ---------- saved chats ----------
function scrubber(list) {
  const counts = {}
  for (const t of list) counts[dayKey(t.updatedAt)] = (counts[dayKey(t.updatedAt)] || 0) + 1
  const max = Math.max(1, ...Object.values(counts))
  const today = dayKey(Date.now())
  $('days').innerHTML = Array.from({ length: 14 }, (_, i) => {
    const ms = Date.now() - (13 - i) * DAY, k = dayKey(ms), n = counts[k] || 0
    const label = `${dayOf(ms)}: ${n ? plural(n, 'chat') : 'no chats'}`
    return `<span class="col${n ? ' has' : ''}${k === today ? ' today' : ''}" data-day="${k}" title="${label}" style="--h:${n / max}">
      <i></i><b>${new Date(ms).toLocaleDateString([], { weekday: 'narrow' })}</b></span>`
  }).join('')
  const days = Object.keys(counts).length
  $('count').textContent = list.length ? `${list.length}` : ''
  const slider = $('days') // only focusable when there is a day to jump to
  slider.tabIndex = list.length ? 0 : -1
  slider.toggleAttribute('aria-disabled', !list.length)
  slider.setAttribute('aria-valuenow', '14')
  slider.setAttribute('aria-valuetext', list.length ? `${plural(list.length, 'chat')} over ${plural(days, 'day')}; use the arrow keys to pick a day` : 'No chats yet')
}

let listedOnce = false
async function loadChats() {
  const box = $('timeline-list')
  try {
    threads = await api('/api/threads')
  } catch (err) {
    // A failed load is not an empty history: say so, and keep whatever was already shown.
    box.removeAttribute('aria-busy')
    if (!box.querySelector('.day')) box.innerHTML = `<p class="memory-note error">Couldn’t load your chats. ${esc(err.message)}</p>`
    if (!$('days').children.length) scrubber([])
    return
  }
  box.removeAttribute('aria-busy')
  scrubber(threads)
  if (!threads.length) { box.innerHTML = '<p class="memory-note">Your chats will show up here.</p>'; return }
  const name = (ms) => { const k = dayKey(ms); return k === dayKey(Date.now()) ? 'Today' : k === dayKey(Date.now() - DAY) ? 'Yesterday' : dayOf(ms) }
  let html = '', day = ''
  for (const t of threads) {
    if (dayKey(t.updatedAt) !== day) {
      if (day) html += '</ul></div>'
      day = dayKey(t.updatedAt)
      html += `<div class="day" id="d-${day}"><h2>${esc(name(t.updatedAt))}</h2><ul>`
    }
    html += `<li class="chat" data-id="${esc(t.id)}"><a class="chat-link" href="/?c=${encodeURIComponent(t.id)}" title="${esc(t.title)}">${esc(t.title)}</a>
      <button type="button" class="del" aria-label="Delete chat: ${esc(t.title)}">${icon('trash')}<span>Delete</span></button></li>`
  }
  box.innerHTML = html + '</ul></div>'
  markActive()
  if (!listedOnce) {
    listedOnce = true
    animate(box.querySelectorAll('.chat'), { opacity: [0, 1], x: [-6, 0] }, { delay: M?.stagger(0.025), duration: 0.3 })
  }
}

function markActive() {
  for (const li of document.querySelectorAll('#timeline-list .chat')) {
    const on = li.dataset.id === threadId
    li.classList.toggle('active', on)
    const a = li.querySelector('a')
    on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')
  }
}

async function openChat(id, push = true) {
  if (busy) return
  let turns
  const bar = $('progress') // Motion's progress-bar loader, along the top while the chat loads
  bar.hidden = false
  const run = M && !calm ? M.animate(bar, { scaleX: [0, 0.8] }, { duration: 1.2, ease: [0.2, 0, 0, 1] }) : null
  try {
    turns = await api(`/api/threads/${encodeURIComponent(id)}`)
  } catch (err) {
    status(`Couldn’t open that chat: ${err.message}`, 'error')
    return
  } finally {
    run?.stop()
    animate(bar, { scaleX: 1, opacity: [1, 0] }, { duration: 0.25 }).then(() => { bar.hidden = true; bar.style.opacity = '' })
  }
  if (!turns.length) { newChat(false); history.replaceState(null, '', '/'); return } // deleted, or never yours
  threadId = id
  main.classList.remove('empty')
  chat.innerHTML = ''
  for (const t of turns) {
    addMessage('user', t.question, false)
    const el = addMessage('agent', '', false)
    const sources = t.sources.map((s, i) => ({ ...s, n: i + 1 }))
    el.querySelector('.body').innerHTML = markdown(t.answer, sources)
    finish(el, t.answer, sources, [`${dayOf(t.askedAt)}, ${timeOf(t.askedAt)}`])
  }
  scrollDown(true)
  animate(chat, { opacity: [0, 1], y: [6, 0] }, { duration: 0.25 })
  document.title = `${turns[0].question.slice(0, 60)} · Remembot`
  if (push) history.pushState(null, '', `/?c=${encodeURIComponent(id)}`)
  markActive()
  setMenu(false)
}

function newChat(push = true) {
  if (busy) return
  threadId = crypto.randomUUID()
  document.title = 'Remembot'
  if (push && location.search) history.pushState(null, '', '/')
  welcome()
  markActive()
  setMenu(false)
  input.focus()
}

// Delete takes two presses: the first arms the button, the second deletes.
$('timeline-list').addEventListener('click', async (e) => {
  const a = e.target.closest('.chat-link')
  if (a && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); openChat(a.closest('.chat').dataset.id); return }
  const del = e.target.closest('.del')
  if (!del) return
  const li = del.closest('.chat')
  if (!del.classList.contains('armed')) {
    del.classList.add('armed')
    del.setAttribute('aria-label', 'Press again to delete this chat for good')
    setTimeout(() => { del.classList.remove('armed'); del.setAttribute('aria-label', `Delete chat: ${li.querySelector('a').title}`) }, 3000)
    return
  }
  try {
    await api(`/api/threads/${encodeURIComponent(li.dataset.id)}`, { method: 'DELETE', body: '{}' })
  } catch (err) {
    status(`Couldn’t delete: ${err.message}`, 'error')
    return
  }
  await animate(li, { opacity: 0, x: -16, height: 0 }, { duration: 0.22, ease: [0.4, 0, 1, 1] })
  const wasOpen = li.dataset.id === threadId
  await loadChats()
  if (wasOpen) newChat()
  status('Chat deleted')
  islandTimer = setTimeout(() => status(''), 2000)
})
addEventListener('popstate', () => {
  const id = new URLSearchParams(location.search).get('c')
  id ? openChat(id, false) : newChat(false)
})

// ---------- streaming ----------
async function* stream(path, body, signal) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal })
  if (res.status === 401) { location.replace('/login'); throw new Error('Signed out') }
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`)
  const reader = res.body.getReader(), decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const frames = buffer.split('\n\n')
    buffer = frames.pop()
    for (const f of frames) if (f.startsWith('data: ')) yield JSON.parse(f.slice(6))
  }
}

function setBusy(controller) {
  busy = controller
  document.documentElement.classList.toggle('thinking', !!busy) // the mark's dot pulses
  sendBtn.setAttribute('aria-label', busy ? 'Stop' : 'Send')
  swapIcon(sendBtn, icon(busy ? 'stop' : 'arrow'))
  sendBtn.disabled = !busy && !input.value.trim()
}

async function send(text) {
  text = text.trim()
  if (!text || busy) return
  if (main.classList.contains('empty')) { main.classList.remove('empty'); chat.innerHTML = '' }
  pinned = true
  input.value = ''; input.style.height = 'auto'; charsLeft()
  addMessage('user', text)
  const el = addMessage('agent')
  const trace = el.querySelector('.trace'), body = el.querySelector('.body'), meta = el.querySelector('.meta')
  // The trace folds into one line ("Recalled 3 exchanges, searched 2 times"); the steps open beneath it.
  const did = { recalled: 0, missing: false, searched: 0, waited: 0 }
  const summary = () => {
    const parts = [
      did.recalled ? `recalled ${plural(did.recalled, 'exchange')}` : did.missing ? 'nothing remembered for that day' : '',
      did.searched ? `searched ${plural(did.searched, 'time')}` : '',
      did.waited ? `waited ${did.waited} s for the model` : '',
    ].filter(Boolean).join(', ')
    return parts.charAt(0).toUpperCase() + parts.slice(1)
  }
  const step = (kind, html) => {
    trace.querySelector('ol').insertAdjacentHTML('beforeend', `<li class="${kind}">${icon(kind)}${html}</li>`)
    trace.querySelector('summary').textContent = summary()
    if (trace.hidden) { trace.hidden = false; animate(trace, { opacity: [0, 1], y: [-4, 0] }, { duration: 0.2 }) }
    scrollDown()
  }
  let answer = '', sources = [], firstTokenMs = 0
  const started = performance.now()
  // Until the first word, the answer is Motion's pulsing dots.
  const paint = () => {
    body.innerHTML = answer ? markdown(answer, sources) : DOTS
    if (!answer) pulse(body)
    scrollDown()
  }

  setBusy(new AbortController())
  paint()
  body.classList.add('cursor')
  status('Recalling')
  try {
    for await (const e of stream('/api/chat', { threadId, message: text, tz }, busy.signal)) {
      if (e.type === 'memory') {
        const found = e.windows.filter((w) => w.count)
        did.recalled += found.reduce((n, w) => n + w.count, 0) + (e.related || 0)
        did.missing = !found.length && e.windows.length > 0
        if (found.length) step('memory', `Remembered ${found.map((w) => `${w.count} from <span class="tag recall">${esc(w.label)}</span>`).join(', ')}`)
        else if (e.windows.length) step('memory', `Nothing remembered for ${e.windows.map((w) => `<b>${esc(w.label)}</b>`).join(' or ')}`)
        if (e.related) step('memory', `Remembered ${e.related} related exchange${e.related > 1 ? 's' : ''}`)
        status('Thinking')
      } else if (e.type === 'search') {
        answer = ''; paint() // anything said before a search was a preamble, not the answer
        did.searched += e.queries.length
        step('search', `Searched ${e.queries.map((q) => `<span class="chip">${esc(q)}</span>`).join('')}`)
        status(e.queries.length > 1 ? `Searching ${e.queries.length} queries in parallel` : 'Searching the web')
      } else if (e.type === 'wait') {
        did.waited += e.seconds
        step('wait', `Model rate limit reached, retrying in ${e.seconds} s`)
        status(`Rate limited, retrying in ${e.seconds} s`, 'wait')
      } else if (e.type === 'sources') {
        sources = e.sources
      } else if (e.type === 'text') {
        if (!firstTokenMs) { firstTokenMs = performance.now() - started; status('Writing') }
        answer += e.delta; paint()
      } else if (e.type === 'done') {
        const secs = (ms) => (ms / 1000).toFixed(1) + ' s'
        finish(el, answer, sources, [timeOf(e.askedAt), `first word ${secs(firstTokenMs)}`, `done ${secs(performance.now() - started)}`,
          e.searches ? `<span class="meter" aria-hidden="true">${Array.from({ length: 6 }, (_, i) => `<b class="${i < e.searches ? 'on' : ''}"></b>`).join('')}</span>${e.searches} of 6 searches`
            : 'Answered from memory'])
        animate(el.querySelectorAll('.sources li'), { opacity: [0, 1], y: [6, 0] }, { delay: M?.stagger(0.05), ...spring })
        scrollDown() // the sources and readout line land after the last token
        if (!new URLSearchParams(location.search).get('c')) history.replaceState(null, '', `/?c=${encodeURIComponent(threadId)}`)
        if (chat.querySelectorAll('.msg.user').length === 1) document.title = `${text.slice(0, 60)} · Remembot`
        loadChats()
      } else if (e.type === 'error') {
        throw new Error(e.message)
      }
    }
    status('')
  } catch (err) {
    if (err.name === 'AbortError') { meta.innerHTML = '<span>Stopped. Not saved.</span>'; status('') }
    else {
      meta.innerHTML = `<span class="error">This answer didn’t finish: ${esc(err.message.replace(/\.$/, ''))}. Ask again to retry.</span>`
      status('Answer failed. Ask again to retry.', 'error')
    }
  }
  if (!answer) body.innerHTML = '' // no dots left pulsing after a stop or an error
  body.classList.remove('cursor')
  setBusy(null)
  input.focus()
}

// ---------- composer ----------
function charsLeft() {
  const left = MAX_CHARS - input.value.length, el = $('left')
  el.hidden = left > 200
  el.textContent = `${left}`
  el.classList.toggle('low', left <= 50)
}
$('form').addEventListener('submit', (e) => { e.preventDefault(); busy ? busy.abort() : send(input.value) })
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value) } })
input.addEventListener('input', () => {
  input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'
  if (!busy) sendBtn.disabled = !input.value.trim()
  charsLeft()
})
for (const id of ['new', 'new-side', 'new-rail']) $(id).addEventListener('click', () => newChat())

// ---------- account ----------
const accountBtn = $('account-btn'), accountMenu = $('account-menu')
function setAccount(open) {
  accountMenu.hidden = !open
  accountBtn.setAttribute('aria-expanded', String(open))
  if (open) animate(accountMenu, { opacity: [0, 1], y: [6, 0], scale: [0.98, 1] }, { type: 'spring', stiffness: 500, damping: 32 })
}
accountBtn.addEventListener('click', (e) => { e.stopPropagation(); setAccount(accountMenu.hidden) })
document.addEventListener('click', (e) => { if (!accountMenu.hidden && !e.target.closest('.account')) setAccount(false) })
$('signout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
  location.replace('/login')
})
const dialog = $('delete-dialog')
$('delete-account').addEventListener('click', () => { setAccount(false); $('delete-error').textContent = ''; dialog.showModal(); $('delete-password').focus() })
$('delete-cancel').addEventListener('click', () => dialog.close())
$('delete-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = $('delete-confirm')
  btn.disabled = true
  try {
    await api('/api/auth/me', { method: 'DELETE', body: JSON.stringify({ password: $('delete-password').value }) })
    location.replace('/login')
  } catch (err) {
    $('delete-error').textContent = err.message
    btn.disabled = false
    animate(dialog, { x: [0, -8, 7, -4, 3, 0] }, { duration: 0.35 })
  }
})
const signedIn = api('/api/auth/me').then((user) => {
  me = user
  $('avatar').textContent = (me.name.trim()[0] || '?').toUpperCase()
  $('who-name').textContent = me.name
  $('who-email').textContent = me.email
  accountBtn.setAttribute('aria-label', `Account: ${me.name}`)
}).catch(() => {})

// ---------- phone drawer ----------
// The button reports its state, Escape or a tap outside closes it, focus moves in and comes back.
const menuBtn = $('menu'), memory = $('memory'), panel = $('panel')
function setMenu(open) {
  if (document.body.classList.contains('menu-open') === open) return
  document.body.classList.toggle('menu-open', open)
  menuBtn.setAttribute('aria-expanded', String(open))
  if (open) ([...memory.querySelectorAll('button:not(:disabled), a, [tabindex="0"]')].find((el) => el.offsetParent !== null) || memory).focus()
  else if (memory.contains(document.activeElement)) menuBtn.focus()
}
menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(!document.body.classList.contains('menu-open')) })
main.addEventListener('click', () => setMenu(false))
addEventListener('keydown', (e) => { if (e.key === 'Escape') { setMenu(false); setAccount(false) } })

// ---------- desktop sidebar ----------
// Collapses to a rail of icons (Ctrl/Cmd+B toggles). The choice is remembered.
const desktop = matchMedia('(min-width: 821px)'), root = document.documentElement
function setSidebar(open) {
  root.classList.toggle('collapsed', !open)
  panel.inert = !open
  $('collapse').setAttribute('aria-expanded', String(open))
  try { localStorage.setItem('remembot-sidebar', open ? 'open' : 'closed') } catch {}
  ;(open ? $('collapse') : $('expand')).focus({ preventScroll: true })
}
const syncLayout = () => { panel.inert = desktop.matches && root.classList.contains('collapsed') }
desktop.addEventListener('change', syncLayout); syncLayout()
requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('ready'))) // animate toggles, not the first paint
$('collapse').addEventListener('click', () => setSidebar(false))
$('expand').addEventListener('click', () => setSidebar(true))
addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b' && desktop.matches) { e.preventDefault(); setSidebar(root.classList.contains('collapsed')) }
})

// ---------- day scrubber ----------
// Click a day, or press and drag across the bars; arrows step between days with chats.
const cols = () => [...$('days').children]
function jumpTo(c) {
  const group = c && c.classList.contains('has') && $(`d-${c.dataset.day}`)
  if (!group) return
  document.querySelectorAll('.day.flash').forEach((d) => d.classList.remove('flash'))
  cols().forEach((x) => x.classList.toggle('on', x === c))
  group.classList.add('flash')
  $('days').setAttribute('aria-valuenow', String(cols().indexOf(c) + 1))
  $('days').setAttribute('aria-valuetext', c.title)
  group.querySelector('h2').scrollIntoView({ block: 'start' })
}
let scrubbing = false
const dayAt = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest('#days .col')
$('days').addEventListener('pointerdown', (e) => { scrubbing = true; jumpTo(dayAt(e)) })
$('days').addEventListener('pointermove', (e) => { const b = scrubbing && dayAt(e); if (b && !b.classList.contains('on')) jumpTo(b) })
addEventListener('pointerup', () => { scrubbing = false })
$('days').addEventListener('keydown', (e) => {
  const has = cols().filter((c) => c.classList.contains('has'))
  const cur = has.indexOf(document.querySelector('#days .on')), last = has.length - 1
  const next = { Home: 0, End: last, ArrowLeft: cur < 0 ? last : cur - 1, ArrowDown: cur < 0 ? last : cur - 1,
    ArrowRight: cur < 0 ? last : cur + 1, ArrowUp: cur < 0 ? last : cur + 1 }[e.key]
  if (next === undefined || !has.length) return
  e.preventDefault()
  jumpTo(has[Math.max(0, Math.min(last, next))])
})

tactile(document.querySelectorAll('#send, .side-new, .icon-btn, .key'))
magnetic(sendBtn)
drawMark(document.querySelector('.brand .mark'))
const opening = new URLSearchParams(location.search).get('c')
if (opening) { main.classList.remove('empty'); openChat(opening, false) }
// The greeting needs the name and whether there is a past, so it waits for both (or their failure).
Promise.allSettled([signedIn, loadChats()]).then(() => { if (!opening) welcome() })
