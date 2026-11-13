// Runs in <head>, before first paint: marks JS as on and restores the collapsed sidebar, so neither flashes.
document.documentElement.classList.add('js')
try { if (localStorage.getItem('remembot-sidebar') === 'closed') document.documentElement.classList.add('collapsed') } catch {}
