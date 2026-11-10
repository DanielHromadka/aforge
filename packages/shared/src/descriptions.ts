import type { Project } from './index.js'
import type { ItemKind } from './items.js'
import { itemOf } from './items.js'

export type DescriptionKind = 'epic' | 'story'
export interface DescriptionRevision { version: number; text: string; author: string; createdAt: string }
export interface ProjectAttachment {
  id: string
  name: string
  storageName: string
  mime: string
  size: number
  itemKind: ItemKind
  itemId: string
  /** Extra references preserve attachments after a story merge or split. */
  refs?: { kind: ItemKind; id: string }[]
  createdAt: string
  uploadedBy: string
}
export const descriptionKey = (kind: DescriptionKind, id: string) => `${kind}:${id}`
export const descriptionOf = (p: Project, kind: DescriptionKind, id: string): string =>
  (kind === 'epic' ? p.epics : p.stories)?.find((item) => item.id === id)?.description ?? ''
export const descriptionVersion = (p: Project, kind: DescriptionKind, id: string) => p.descriptionHistory?.[descriptionKey(kind, id)]?.length ?? 0
export const attachmentRef = (id: string) => `attachment:${id}`
export const attachmentsFor = (p: Project, kind: ItemKind, id: string) => (p.attachments ?? []).filter((a) => (a.itemKind === kind && a.itemId === id) || a.refs?.some((r) => r.kind === kind && r.id === id))
export const attachmentWorkspacePath = (a: ProjectAttachment) => `.aforge/attachments/${a.storageName}`
export const activeAttachments = (p: Project) => (p.attachments ?? []).filter((a) => itemOf(p, a.itemKind, a.itemId) || a.refs?.some((r) => itemOf(p, r.kind, r.id))
  || [...(p.epics ?? []), ...p.stories].some((item) => item.description?.includes(attachmentRef(a.id))))
export const markdownForAgents = (p: Project, text: string) => text.replace(/attachment:([a-f0-9-]{36})/g, (url, id: string) => {
  const a = p.attachments?.find((a) => a.id === id)
  return a ? attachmentWorkspacePath(a) : url
})

/** Every save path, including agent proposals, records changed bodies; a restore creates another version. */
export const captureDescriptionHistory = (before: Project | undefined, next: Project, author: string, at: string): Project => {
  const history = { ...(before?.descriptionHistory ?? {}) }
  for (const kind of ['epic', 'story'] as const) {
    const items = kind === 'epic' ? next.epics ?? [] : next.stories
    const oldItems = kind === 'epic' ? before?.epics ?? [] : before?.stories ?? []
    for (const item of items) {
      const old = oldItems.find((old) => old.id === item.id)
      const text = item.description ?? ''
      if ((old && text === (old.description ?? '')) || (!old && !text)) continue
      const key = descriptionKey(kind, item.id)
      const revisions = [...(history[key] ?? [])]
      if (!revisions.length && old) revisions.push({ version: 1, text: old.description ?? '', author: 'Původní verze', createdAt: before?.updatedAt ?? at })
      revisions.push({ version: revisions.length + 1, text, author, createdAt: at })
      history[key] = revisions
    }
  }
  return Object.keys(history).length ? { ...next, descriptionHistory: history } : { ...next, descriptionHistory: undefined }
}
