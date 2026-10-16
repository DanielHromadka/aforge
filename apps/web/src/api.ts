import { useEffect, useRef } from 'react'

export const api = async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`)
  return data as T
}

export interface HubEvent {
  channel: 'build' | 'preview' | 'tests' | 'project'
  kind: string
  text: string
  at: string
  data?: unknown
}

/** One SSE connection per open project; the handler is read through a ref so it can change freely. */
export const useProjectEvents = (projectId: string | undefined, onEvent: (e: HubEvent) => void) => {
  const handler = useRef(onEvent)
  handler.current = onEvent
  useEffect(() => {
    if (!projectId) return
    const es = new EventSource(`/api/projects/${projectId}/events`)
    es.onmessage = (m) => handler.current(JSON.parse(m.data) as HubEvent)
    return () => es.close()
  }, [projectId])
}

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`
