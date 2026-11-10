import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { activeAttachments, attachmentWorkspacePath, itemOf, type ItemKind, type Project, type ProjectAttachment } from '@aforge/shared'
import { loadProject, mutateProject, projectDir } from './store.js'
import { assertWritable } from './project-locations.js'
import { limits } from './config.js'
import { safePath } from './workspace.js'
import { publish } from './events.js'

export const ATTACHMENT_LIMIT = 20 * 1024 * 1024
export const attachmentDir = (id: string) => join(projectDir(id), 'attachments')
export const attachmentImageType = (data: Buffer): string | undefined => {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg'
  if (/^GIF8[79]a$/.test(data.subarray(0, 6).toString('ascii'))) return 'image/gif'
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return undefined
}
const safeStorage = (name: string) => /^[a-f0-9-]{36}(?:\.[a-z0-9]{1,12})?$/.test(name)
export const attachmentPath = (projectId: string, a: ProjectAttachment) => {
  if (!safeStorage(a.storageName)) throw new Error('Neplatný soubor přílohy.')
  return join(attachmentDir(projectId), a.storageName)
}
export const uploadAttachment = async (projectId: string, kind: ItemKind, itemId: string, name: string, data: Buffer, userId: string): Promise<ProjectAttachment> => {
  assertWritable(projectId)
  if (!data.length || data.length > ATTACHMENT_LIMIT) throw new Error('Soubor musí mít velikost 1 B až 20 MB.')
  if (!itemOf(await loadProject(projectId), kind, itemId)) throw new Error('Položka už neexistuje.')
  const cleanName = basename(name.replaceAll('\\', '/')).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 240) || 'soubor'
  const extension = extname(cleanName).toLowerCase()
  const id = randomUUID()
  const image = attachmentImageType(data)
  const text = /\.(txt|md|csv|tsv|json|yaml|yml|xml|log|html|css|js|ts|sql)$/i.test(cleanName)
  const a: ProjectAttachment = { id, name: cleanName, storageName: `${id}${/^\.[a-z0-9]{1,12}$/.test(extension) ? extension : ''}`, mime: image ?? (text ? 'text/plain' : 'application/octet-stream'), size: data.length, itemKind: kind, itemId, createdAt: new Date().toISOString(), uploadedBy: userId }
  await mkdir(attachmentDir(projectId), { recursive: true })
  await writeFile(attachmentPath(projectId, a), data, { flag: 'wx' })
  try {
    await mutateProject(projectId, (p) => {
      if (!itemOf(p, kind, itemId)) throw new Error('Položka už neexistuje.')
      if ((p.attachments ?? []).reduce((n, a) => n + a.size, 0) + data.length > limits.attachmentBytes) throw Object.assign(new Error('Projekt vyčerpal limit příloh.'), { statusCode: 413 })
      return { ...p, attachments: [...(p.attachments ?? []), a] }
    })
  } catch (error) { await rm(attachmentPath(projectId, a), { force: true }); throw error }
  publish(projectId, 'project', 'changed', '')
  return a
}

/** Text is available to analysts; every binary also travels into each implementation repository/bundle. */
export const attachmentContext = async (p: Project) => {
  let remaining = 60_000
  return Promise.all(activeAttachments(p).map(async (a) => {
    let text: string | undefined
    if (a.mime === 'text/plain' && remaining > 0) {
      const limit = Math.min(12_000, remaining); remaining -= limit
      try { text = (await readFile(attachmentPath(p.id, a), 'utf8')).slice(0, limit) } catch { text = '(soubor není dostupný)' }
    }
    return { id: a.id, name: a.name, mime: a.mime, size: a.size, itemKind: a.itemKind, itemId: a.itemId, refs: a.refs, path: attachmentWorkspacePath(a), ...(text !== undefined ? { text } : {}) }
  }))
}
export const stageAttachments = async (p: Project, repo?: string): Promise<boolean> => {
  if (!p.attachments?.length) return false
  const target = safePath(p.id, '.aforge/attachments', repo)
  await mkdir(target, { recursive: true })
  let changed = false
  const active = activeAttachments(p)
  for (const a of p.attachments.filter((a) => !active.some((x) => x.id === a.id))) {
    attachmentPath(p.id, a)
    const old = join(target, a.storageName)
    try { await readFile(old); await rm(old, { force: true }); changed = true } catch { /* Already absent. */ }
  }
  for (const a of active) {
    const data = await readFile(attachmentPath(p.id, a))
    const path = join(target, a.storageName)
    let identical = false
    try { identical = createHash('sha256').update(await readFile(path)).digest('hex') === createHash('sha256').update(data).digest('hex') } catch { /* First staging. */ }
    if (!identical) { await copyFile(attachmentPath(p.id, a), path); changed = true }
  }
  return changed
}
