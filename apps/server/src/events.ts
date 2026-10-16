// Per-project event bus behind the SSE endpoint: build output, container logs and test progress.
import { EventEmitter } from 'node:events'

export type Channel = 'build' | 'preview' | 'tests' | 'project'

export interface HubEvent {
  channel: Channel
  kind: string
  text: string
  at: string
  data?: unknown
}

const bus = new EventEmitter()
bus.setMaxListeners(0)

export const publish = (projectId: string, channel: Channel, kind: string, text: string, data?: unknown) =>
  bus.emit(projectId, { channel, kind, text, at: new Date().toISOString(), data } satisfies HubEvent)

export const subscribe = (projectId: string, fn: (e: HubEvent) => void) => {
  bus.on(projectId, fn)
  return () => bus.off(projectId, fn)
}
