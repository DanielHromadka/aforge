// Plain History API routing: a handful of top-level pages and the editor at /p/<id>.
import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()
window.addEventListener('popstate', () => listeners.forEach((l) => l()))

export const navigate = (path: string, replace = false) => {
  if (path === location.pathname + location.search) return
  history[replace ? 'replaceState' : 'pushState'](null, '', path)
  listeners.forEach((l) => l())
}

export const usePath = () =>
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => location.pathname)
