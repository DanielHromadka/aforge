// Figma import over the REST API with a personal access token: every frame becomes a screen and its
// visible layers become wireframe elements, with the kind guessed from the layer type and name.
import type { Screen, WireElement } from '@aforge/shared'

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
  return { fileKey: m[1]!, nodeId: node ? node.replace('-', ':') : undefined }
}

const KIND_BY_NAME: [RegExp, WireElement['kind']][] = [
  [/button|btn|tlačítko|cta/i, 'button'],
  [/input|field|textbox|search|pole/i, 'input'],
  [/nav|header|menu|toolbar|tab ?bar/i, 'nav'],
  [/image|img|photo|avatar|icon|logo|obrázek/i, 'image'],
  [/table|grid|tabulka/i, 'table'],
  [/list|seznam/i, 'list'],
  [/card|karta|tile/i, 'card'],
]

const kindOf = (n: FigmaNode): WireElement['kind'] => {
  if (n.type === 'TEXT') return 'text'
  for (const [re, kind] of KIND_BY_NAME) if (re.test(n.name)) return kind
  return 'container'
}

/** Recognized components are kept whole; plain groups are opened up to a few levels. */
const collect = (frame: FigmaNode, maxDepth = 4): WireElement[] => {
  const origin = frame.absoluteBoundingBox!
  const out: WireElement[] = []
  const walk = (node: FigmaNode, depth: number) => {
    for (const child of node.children ?? []) {
      if (child.visible === false || !child.absoluteBoundingBox) continue
      const kind = kindOf(child)
      const b = child.absoluteBoundingBox
      const big = b.width * b.height > 400
      if (kind !== 'container' || (big && depth <= 2)) {
        out.push({
          id: `el-fg-${child.id.replace(/[^0-9a-z]/gi, '-')}`,
          kind,
          x: Math.round(b.x - origin.x),
          y: Math.round(b.y - origin.y),
          w: Math.round(b.width),
          h: Math.round(b.height),
          label: (child.characters ?? child.name).slice(0, 120),
          note: '',
          storyIds: [],
        })
      }
      if (kind === 'container' && depth < maxDepth) walk(child, depth + 1)
    }
  }
  walk(frame, 1)
  return out.slice(0, 400)
}

export const importFigma = async (url: string, token: string): Promise<Screen[]> => {
  const { fileKey, nodeId } = parseFigmaUrl(url)
  const endpoint = nodeId
    ? `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`
    : `https://api.figma.com/v1/files/${fileKey}?depth=6`
  const res = await fetch(endpoint, { headers: { 'X-Figma-Token': token } })
  if (!res.ok) throw new Error(`Figma API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = (await res.json()) as { document?: FigmaNode; nodes?: Record<string, { document: FigmaNode }> }
  const roots = nodeId ? Object.values(json.nodes ?? {}).map((n) => n.document) : (json.document?.children ?? [])
  const frames: FigmaNode[] = []
  const findFrames = (n: FigmaNode) => {
    if ((n.type === 'FRAME' || n.type === 'COMPONENT') && n.absoluteBoundingBox) frames.push(n)
    else for (const c of n.children ?? []) if (c.type === 'FRAME' || c.type === 'CANVAS' || c.type === 'SECTION' || c.type === 'COMPONENT') findFrames(c)
  }
  roots.forEach(findFrames)
  return frames.slice(0, 30).map((f) => ({
    id: `screen-fg-${f.id.replace(/[^0-9a-z]/gi, '-')}`,
    name: f.name,
    width: Math.round(f.absoluteBoundingBox!.width),
    height: Math.round(f.absoluteBoundingBox!.height),
    elements: collect(f),
  }))
}
