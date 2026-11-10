import { appendFileSync, existsSync, statSync, renameSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { projectDir, sessionContext } from './project-locations.js'
import type { HubEvent } from './events.js'

export const recordEvent = (id: string, event: HubEvent) => {
  try {
    const context = sessionContext(id)
    if (context.snapshot || context.archivedAt || !existsSync(projectDir(id))) return
    const file = join(projectDir(id), 'events.jsonl')
    if (existsSync(file) && statSync(file).size > 20 * 1024 ** 2) renameSync(file, file + '.previous')
    appendFileSync(file, JSON.stringify(event) + '\n')
  } catch { /* Journaling must not interrupt a running job if its disk becomes unavailable. */ }
}
export const readJournal = async (id: string): Promise<HubEvent[]> => {
  const handle = await open(join(projectDir(id), 'events.jsonl'), 'r').catch(() => null)
  if (!handle) return []
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, 2_000_000)
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, size - length)
    return buf.toString('utf8').split('\n').flatMap((line) => {
      try { return [JSON.parse(line) as HubEvent] } catch { return [] }
    }).slice(-2000)
  } finally { await handle.close() }
}
