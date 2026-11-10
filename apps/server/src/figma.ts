// Figma sync over the REST API with a personal access token. The design lives in Figma: every frame
// becomes a screen with its rendered image and its layer tree, and a sync replaces both while keeping
// what Reactor adds to a layer (note, stories, the work mark) by the layer's id.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesignElement, ElementAnnotation, ElementKind, Project, Screen } from '@aforge/shared'
import { projectDir } from './store.js'

interface FigmaNode {
  id: string
  name: string
  type: string
  visible?: boolean
  characters?: string
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number } | null
  children?: FigmaNode[]
}

export const parseFigmaUrl = (url: string): { fileKey: string; nodeId?: string } => {
  const m = url.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/)
  if (!m) throw new Error('Neplatný odkaz na Figmu')
  const node = new URL(url).searchParams.get('node-id')
  return { fileKey: m[1]!, nodeId: node ? node.replace(/-/g, ':') : undefined }
}

const KIND_BY_NAME: [RegExp, ElementKind][] = [
  [/button|btn|tlačítko|cta/i, 'button'],
  [/input|field|textbox|search|pole/i, 'input'],
  [/nav|header|menu|toolbar|tab ?bar/i, 'nav'],
  [/image|img|photo|avatar|icon|logo|obrázek/i, 'image'],
  [/table|grid|tabulka/i, 'table'],
  [/list|seznam/i, 'list'],
  [/card|karta|tile/i, 'card'],
]

const kindOf = (n: FigmaNode): ElementKind => {
  if (n.type === 'TEXT') return 'text'
  for (const [re, kind] of KIND_BY_NAME) if (re.test(n.name)) return kind
  return 'container'
}

/** Vector internals of icons and shapes are not something anyone selects or implements on their own. */
const OPAQUE = new Set(['VECTOR', 'BOOLEAN_OPERATION', 'LINE', 'STAR', 'POLYGON', 'ELLIPSE', 'REGULAR_POLYGON'])
const MAX_ELEMENTS = 1500

const safeId = (figmaId: string) => figmaId.replace(/[^0-9a-z]/gi, '-')

/** The visible layer tree of a frame, parents before children, in Figma's paint order. */
const collect = (frame: FigmaNode): DesignElement[] => {
  const origin = frame.absoluteBoundingBox!
  const out: DesignElement[] = []
  const walk = (node: FigmaNode, parentId: string | undefined, depth: number) => {
    for (const child of node.children ?? []) {
      if (out.length >= MAX_ELEMENTS) return
      const b = child.absoluteBoundingBox
      if (child.visible === false || !b || b.width < 2 || b.height < 2) continue
      if (OPAQUE.has(child.type) && depth > 0) continue
      const id = `el-fg-${safeId(child.id)}`
      out.push({
        id,
        figmaId: child.id,
        parentId,
        kind: kindOf(child),
        type: child.type,
        name: child.name.slice(0, 120),
        text: child.characters?.slice(0, 500),
        x: Math.round(b.x - origin.x),
        y: Math.round(b.y - origin.y),
        w: Math.round(b.width),
        h: Math.round(b.height),
        note: '',
        storyIds: [],
        work: false,
      })
      if (depth < 10) walk(child, id, depth + 1)
    }
  }
  walk(frame, undefined, 0)
  return out
}

const figma = async <T>(path: string, token: string): Promise<T> => {
  const res = await fetch(`https://api.figma.com/v1${path}`, { headers: { 'X-Figma-Token': token } })
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}

const findFrames = async (fileKey: string, nodeId: string | undefined, token: string): Promise<FigmaNode[]> => {
  const json = nodeId
    ? await figma<{ nodes: Record<string, { document: FigmaNode } | null> }>(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, token)
    : await figma<{ document: FigmaNode }>(`/files/${fileKey}`, token)
  const roots = 'nodes' in json ? Object.values(json.nodes).flatMap((n) => (n ? [n.document] : [])) : json.document.children ?? []
  const frames: FigmaNode[] = []
  const visit = (n: FigmaNode) => {
    if (n.visible === false) return
    if ((n.type === 'FRAME' || n.type === 'COMPONENT') && n.absoluteBoundingBox) frames.push(n)
    else if (n.type === 'CANVAS' || n.type === 'SECTION' || n.type === 'DOCUMENT') (n.children ?? []).forEach(visit)
  }
  roots.forEach(visit)
  return frames.slice(0, 40)
}

/** Figma renders at most 32 megapixels per image, so tall frames fall back from 2× to 1×. */
const renderFrames = async (projectId: string, fileKey: string, screens: Screen[], token: string): Promise<void> => {
  const dir = join(projectDir(projectId), 'figma')
  await mkdir(dir, { recursive: true })
  const groups = new Map<number, Screen[]>()
  for (const s of screens) {
    const scale = s.width * s.height * 4 <= 30e6 ? 2 : 1
    groups.set(scale, [...(groups.get(scale) ?? []), s])
  }
  for (const [scale, group] of groups) {
    for (let i = 0; i < group.length; i += 10) {
      const batch = group.slice(i, i + 10)
      const ids = batch.map((s) => s.figmaId).join(',')
      const { images } = await figma<{ images: Record<string, string | null> }>(`/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=png&scale=${scale}`, token)
      await Promise.all(
        batch.map(async (s) => {
          const url = images[s.figmaId]
          if (!url) return
          const res = await fetch(url)
          if (!res.ok) return
          s.image = `${s.id}.png`
          await writeFile(join(dir, s.image), Buffer.from(await res.arrayBuffer()))
        }),
      )
    }
  }
  // Images of frames that are gone from Figma go with them.
  const keep = new Set(screens.flatMap((s) => (s.image ? [s.image] : [])))
  for (const f of await readdir(dir)) if (!keep.has(f)) await rm(join(dir, f), { force: true })
}

export interface SyncResult {
  project: Project
  added: number
  removed: number
  updated: number
}

/** The synced screens with the annotations of the layers that are still there. */
export const mergeSync = (project: Project, screens: Screen[]): Omit<SyncResult, 'project'> & { screens: Screen[] } => {
  const notes = new Map<string, ElementAnnotation>()
  for (const s of project.screens) for (const e of s.elements) notes.set(e.id, { note: e.note, storyIds: e.storyIds, work: e.work })
  const before = new Set(project.screens.map((s) => s.id))
  const merged = screens.map((s) => ({ ...s, elements: s.elements.map((e) => ({ ...e, ...notes.get(e.id) })) }))
  const added = merged.filter((s) => !before.has(s.id)).length
  const updated = merged.length - added
  return { screens: merged, added, updated, removed: before.size - updated }
}

export const syncFigma = async (project: Project, url: string, token: string): Promise<SyncResult> => {
  const { fileKey, nodeId } = parseFigmaUrl(url)
  const frames = await findFrames(fileKey, nodeId, token)
  if (!frames.length) throw new Error('V odkazu ve Figmě není žádný rámec (Frame).')
  const screens: Screen[] = frames.map((f) => ({
    id: `screen-fg-${safeId(f.id)}`,
    figmaId: f.id,
    name: f.name,
    width: Math.round(f.absoluteBoundingBox!.width),
    height: Math.round(f.absoluteBoundingBox!.height),
    elements: collect(f),
  }))
  await renderFrames(project.id, fileKey, screens, token)
  const { screens: merged, ...counts } = mergeSync(project, screens)
  return { ...counts, project: { ...project, screens: merged, figma: { url, syncedAt: new Date().toISOString() } } }
}

