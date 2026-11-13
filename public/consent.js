// Cookie consent and analytics. The session cookie is essential and needs no consent.
// Analytics (Cloudflare Web Analytics, cookieless) loads only after "Accept all".
// To turn analytics on: Cloudflare dashboard > Web Analytics > Add site, then paste the token here.
const CF_ANALYTICS_TOKEN = ''
;(() => {
  const KEY = 'remembot-consent'
  const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
  const save = (v) => { try { localStorage.setItem(KEY, v) } catch {} }

  function loadAnalytics() {
    if (!CF_ANALYTICS_TOKEN || document.querySelector('script[data-cf-beacon]')) return
    const s = document.createElement('script')
    s.defer = true
    s.src = 'https://static.cloudflareinsights.com/beacon.min.js'
    s.dataset.cfBeacon = JSON.stringify({ token: CF_ANALYTICS_TOKEN })
    document.head.append(s)
  }

  function ask() {
    if (document.querySelector('.consent')) return
    const box = document.createElement('section')
    box.className = 'consent'
    box.setAttribute('aria-label', 'Cookies')
    box.innerHTML = `<p>We use one essential cookie to keep you signed in. With your OK we also count visits with privacy-friendly analytics that set no cookies. <a href="/privacy#cookies">Details</a></p>
      <div class="row"><button type="button" class="key quiet" data-v="essential">Essential only</button><button type="button" class="key" data-v="all">Accept all</button></div>`
    box.addEventListener('click', (e) => {
      const v = e.target.closest('button')?.dataset.v
      if (!v) return
      save(v)
      if (v === 'all') loadAnalytics()
      const gone = () => box.remove()
      window.Motion && !matchMedia('(prefers-reduced-motion: reduce)').matches
        ? Motion.animate(box, { opacity: 0, y: 16 }, { duration: 0.2 }).then(gone)
        : gone()
    })
    document.body.append(box)
    window.Motion?.animate(box, { opacity: [0, 1], y: [24, 0] }, { type: 'spring', stiffness: 260, damping: 26, delay: 0.6 })
  }

  const choice = read()
  if (choice === 'all') loadAnalytics()
  else if (!choice) ask()
  // Any element with data-consent-open reopens the choice.
  document.addEventListener('click', (e) => { if (e.target.closest('[data-consent-open]')) { e.preventDefault(); ask() } })
})()
