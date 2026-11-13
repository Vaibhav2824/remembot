// Light/dark switch, after SmoothUI's sun/moon toggle: the icons swap with a turn and a scale on a
// short spring, and the new theme spreads from the switch in a circle (View Transitions).
;(() => {
  const root = document.documentElement
  const M = window.Motion
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
  const meta = document.querySelector('meta[name="theme-color"]')
  const isDark = () => root.dataset.theme === 'dark'
  const sync = () => {
    for (const b of document.querySelectorAll('[data-theme-toggle]')) {
      b.setAttribute('aria-checked', String(isDark()))
      b.setAttribute('aria-label', isDark() ? 'Switch to light mode' : 'Switch to dark mode')
    }
    meta?.setAttribute('content', isDark() ? '#151513' : '#faf8f5')
  }
  const apply = (dark) => {
    if (dark) root.dataset.theme = 'dark'
    else delete root.dataset.theme
    try { localStorage.setItem('remembot-theme', dark ? 'dark' : 'light') } catch {}
    sync()
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-toggle]')
    if (!btn) return
    const dark = !isDark()
    if (M && !calm) {
      const [sun, moon] = btn.querySelectorAll('svg')
      const [out, into] = dark ? [sun, moon] : [moon, sun]
      M.animate(out, { opacity: 0, rotate: dark ? 120 : -120, scale: 0.4 }, { type: 'spring', bounce: 0.1, duration: 0.3 })
      M.animate(into, { opacity: [0, 1], rotate: [dark ? -120 : 120, 0], scale: [0.4, 1] }, { type: 'spring', bounce: 0.1, duration: 0.35 })
    }
    if (!document.startViewTransition || calm) return apply(dark)
    const r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y))
    document.startViewTransition(() => apply(dark)).ready.then(() =>
      root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] }, { duration: 520, easing: 'cubic-bezier(0.2, 0, 0, 1)', pseudoElement: '::view-transition-new(root)' }),
    )
  })
  sync()
})()
