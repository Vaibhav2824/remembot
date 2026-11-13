// Sign in / create account. One form, two modes; the URL hash (#signup) picks the mode.
const $ = (id) => document.getElementById(id)
const M = window.Motion
const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
// Never lets an animation hold up logic: hidden tabs may not run it to the end.
const animate = (el, kf, opts) => (M && !calm && el ? Promise.race([M.animate(el, kf, opts), new Promise((r) => setTimeout(r, 800))]) : Promise.resolve())
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/ // the server's rule
const form = $('auth'), card = $('card'), submit = $('submit'), formError = $('form-error')
const fields = { name: $('name'), email: $('email'), password: $('password') }
let mode = 'login'
const touched = new Set()

const COPY = {
  login: { title: 'Welcome back', sub: 'Sign in to pick up your saved chats.', button: 'Sign in', pw: 'current-password' },
  signup: { title: 'Create your account', sub: 'Free. Your chats are saved and only you can see them.', button: 'Create account', pw: 'new-password' },
}

function setMode(next, focus = false) {
  if (next === mode && document.readyState === 'complete') return
  mode = next
  const c = COPY[mode], signup = mode === 'signup'
  $('tabs').dataset.mode = mode
  for (const [id, m] of [['tab-login', 'login'], ['tab-signup', 'signup']]) {
    $(id).setAttribute('aria-selected', String(m === mode))
    $(id).tabIndex = m === mode ? 0 : -1
  }
  $('form-title').textContent = c.title
  $('form-sub').textContent = c.sub
  submit.textContent = c.button
  fields.password.autocomplete = c.pw
  $('meter').hidden = !signup
  $('fine').hidden = !signup
  const nameField = $('name-field')
  if (signup && nameField.hidden) {
    nameField.hidden = false
    animate(nameField, { opacity: [0, 1], height: [0, nameField.scrollHeight + 'px'] }, { duration: 0.25, ease: [0.2, 0, 0, 1] }).then(() => { nameField.style.height = '' })
  } else if (!signup) nameField.hidden = true
  touched.clear()
  formError.textContent = ''
  for (const k of Object.keys(fields)) showError(k, '')
  passwordHint()
  history.replaceState(null, '', signup ? '#signup' : location.pathname)
  if (focus) (signup ? fields.name : fields.email).focus()
}

// ---------- validation: the same rules the server applies, said before the round trip ----------
function problem(key) {
  const v = fields[key].value
  if (key === 'name' && mode === 'signup') {
    if (!v.trim()) return 'Enter your name.'
  }
  if (key === 'email') {
    if (!v.trim()) return 'Enter your email address.'
    if (!EMAIL.test(v.trim())) return 'That doesn’t look like an email address.'
  }
  if (key === 'password') {
    if (!v) return 'Enter your password.'
    if (mode === 'signup' && v.length < 8) return `Use at least 8 characters (${8 - v.length} more).`
  }
  return ''
}
function showError(key, msg) {
  const hint = $(`${key}-hint`), well = fields[key].closest('.well')
  hint.textContent = msg
  hint.classList.toggle('error', !!msg)
  fields[key].toggleAttribute('aria-invalid', !!msg)
  well.toggleAttribute('data-invalid', !!msg)
  if (key === 'password' && !msg) passwordHint()
}
function passwordHint() {
  if (mode !== 'signup') { $('password-hint').textContent = ''; return }
  const v = fields.password.value
  const score = !v ? 0 : (v.length >= 8) + (v.length >= 12) + (/[a-z]/.test(v) && /[A-Z0-9]/.test(v)) + (/[^\w\s]/.test(v) || v.length >= 16)
  $('meter').dataset.score = String(score)
  if (!$('password-hint').classList.contains('error'))
    $('password-hint').textContent = !v ? 'At least 8 characters. A short sentence works well.' : ['Too short', 'Weak', 'Okay', 'Good', 'Strong'][score]
}
for (const [key, input] of Object.entries(fields)) {
  input.addEventListener('blur', () => { if (input.value) touched.add(key); if (touched.has(key)) showError(key, problem(key)) })
  input.addEventListener('input', () => {
    formError.textContent = ''
    if (touched.has(key)) showError(key, problem(key))
    if (key === 'password') passwordHint()
  })
}

// ---------- submit ----------
form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const keys = mode === 'signup' ? ['name', 'email', 'password'] : ['email', 'password']
  keys.forEach((k) => touched.add(k))
  const bad = keys.filter((k) => { const msg = problem(k); showError(k, msg); return msg })
  if (bad.length) { fields[bad[0]].focus(); shake(); return }

  const body = { email: fields.email.value.trim(), password: fields.password.value, website: $('website').value }
  if (mode === 'signup') body.name = fields.name.value.trim()
  submit.disabled = true
  submit.innerHTML = `<span class="spinner" aria-hidden="true"></span>${mode === 'signup' ? 'Creating your account' : 'Signing in'}`
  try {
    const res = await fetch(`/api/auth/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}). Try again.`)
    await animate(card, { opacity: 0, y: -8, scale: 0.98 }, { duration: 0.22 })
    location.replace('/')
  } catch (err) {
    formError.textContent = err.message === 'Failed to fetch' ? 'Can’t reach Remembot. Check your connection and try again.' : err.message
    submit.disabled = false
    submit.textContent = COPY[mode].button
    shake()
  }
})
const shake = () => animate(card, { x: [0, -10, 9, -6, 4, 0] }, { duration: 0.4, ease: 'easeOut' })

// ---------- tabs, peek, tactile keys ----------
$('tab-login').addEventListener('click', () => setMode('login', true))
$('tab-signup').addEventListener('click', () => setMode('signup', true))
$('tabs').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
  e.preventDefault()
  setMode(mode === 'login' ? 'signup' : 'login')
  $(`tab-${mode}`).focus()
})
addEventListener('hashchange', () => setMode(location.hash === '#signup' ? 'signup' : 'login', true))
$('peek').addEventListener('click', () => {
  const show = fields.password.type === 'password'
  fields.password.type = show ? 'text' : 'password'
  $('peek').textContent = show ? 'Hide' : 'Show'
  $('peek').setAttribute('aria-pressed', String(show))
  $('peek').setAttribute('aria-label', show ? 'Hide password' : 'Show password')
})
$('peek').setAttribute('aria-label', 'Show password')
if (M && !calm) {
  M.press('.key, .peek, .tabs button', (el) => {
    M.animate(el, { scale: 0.96 }, { type: 'spring', stiffness: 900, damping: 30 })
    return () => M.animate(el, { scale: 1 }, { type: 'spring', stiffness: 500, damping: 20 })
  })
}

// ---------- entrance ----------
setMode(location.hash === '#signup' ? 'signup' : 'login')
if (M && !calm) {
}
demo()

// ---------- the demo: one Remembot exchange, played as a loop ----------
// The markup is the poster (the finished answer), so no-JS and reduced motion see the payoff.
// Beats: the question lands; Tuesday's chat is recalled (the satellite arrives with it); the
// search count follows; the answer streams in place; its sources land; hold; "New chat" resets.
function demo() {
  const box = $('demo'), stage = box.querySelector('.demo-stage')
  const fit = () => {
    const w = box.clientWidth, compact = w < 480
    box.classList.toggle('compact', compact)
    const [W, H] = compact ? [358, 420] : [560, 420]
    const k = Math.min(1, w / W)
    stage.style.transform = `scale(${k})`
    stage.style.left = `${Math.max(0, (w - W * k) / 2)}px` // centred in a wider panel
    box.style.height = `${H * k}px`
  }
  new ResizeObserver(fit).observe(box)
  fit()
  if (!M || calm) return

  // Every word is laid out from the start, so the answer grows in place without reflow.
  const ans = box.querySelector('.ans')
  for (const node of [...ans.childNodes]) {
    if (node.nodeType !== Node.TEXT_NODE) continue
    const frag = document.createDocumentFragment()
    for (const part of node.textContent.split(/(\s+)/)) {
      if (!part) continue
      if (/^\s+$/.test(part)) { frag.append(part); continue }
      const w = document.createElement('span')
      w.textContent = part
      frag.append(w)
    }
    node.replaceWith(frag)
  }
  const words = [...ans.children]
  for (const w of words) w.style.transition = 'opacity 0.2s cubic-bezier(0.2, 0, 0, 1)'

  const one = (name) => box.querySelector(`[data-beat="${name}"]`)
  const [trace, sat] = box.querySelectorAll('[data-beat="recall"]')
  const srcs = [...one('sources').children]
  const added = [one('q'), trace, sat, ans, ...srcs]
  const spring = { type: 'spring', stiffness: 380, damping: 30 }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let inView = true
  new IntersectionObserver(([e]) => { inView = e.isIntersecting }).observe(box)

  const reset = () => {
    for (const el of [...added, one('search')]) M.animate(el, { opacity: 0, y: 0, x: 0, scale: 1 }, { duration: 0 })
    for (const w of words) w.style.opacity = '0'
  }
  ;(async () => {
    for (;;) {
      reset()
      await sleep(1200)
      while (document.hidden || !inView) await sleep(400)
      M.animate(one('q'), { opacity: [0, 1], y: [10, 0] }, spring)
      await sleep(1000)
      M.animate(trace, { opacity: [0, 1], y: [6, 0] }, spring)
      M.animate(sat, { opacity: [0, 1], x: [-12, 0], scale: [0.96, 1] }, { type: 'spring', stiffness: 260, damping: 26 })
      await sleep(1100)
      M.animate(one('search'), { opacity: [0, 1] }, { duration: 0.3 })
      await sleep(900)
      M.animate(ans, { opacity: 1 }, { duration: 0 })
      for (const w of words) { w.style.opacity = '1'; await sleep(55) }
      await sleep(300)
      M.animate(srcs, { opacity: [0, 1], y: [6, 0] }, { delay: M.stagger(0.08), ...spring })
      await sleep(3800)
      // The reset has a cause: New chat is pressed, then everything the loop added leaves at once.
      if (!box.classList.contains('compact')) await animate(box.querySelector('.newchat b'), { scale: [1, 0.8, 1] }, { duration: 0.35 })
      await animate(added, { opacity: 0 }, { duration: 0.3 })
      await sleep(300)
    }
  })()
}
