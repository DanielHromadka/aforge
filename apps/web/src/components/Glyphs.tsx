// The visual vocabulary of the editor: one colour and icon per step, Jira's issue type icons and six status
// shapes. Colours are the --c-* and --t-* tokens of styles.css, so the same step looks the same everywhere.
import type { ReactNode } from 'react'
import type { AgentRole, IssueStatus, IssueType, Layer, Platform, Stage } from '@aforge/shared'

const Svg = ({ children, size = 16, stroke = 1.5 }: { children: ReactNode; size?: number; stroke?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const G = {
  bell: () => <><path d="M3 11.5h10l-1.4-2V6a3.6 3.6 0 0 0-7.2 0v3.5L3 11.5zM6.5 13.5a1.6 1.6 0 0 0 3 0M8 1v1.5" /></>,
  overview: () => <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.2" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.2" /><rect x="9" y="9" width="4.5" height="4.5" rx="1.2" /></>,
  design: () => <><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M2 5.5h12M5 8.5h3M5 11h6" /></>,
  story: () => <><path d="M4 2.5h6l2.5 2.5v8.5H4z" /><path d="M6 7h4.5M6 9.5h4.5M6 12h2.5" /></>,
  board: () => <><rect x="2" y="2.5" width="3.4" height="11" rx="1" /><rect x="6.3" y="2.5" width="3.4" height="7" rx="1" /><rect x="10.6" y="2.5" width="3.4" height="9" rx="1" /></>,
  split: () => <path d="M8 2v4M8 6 4 10v3.5M8 6l4 4v3.5" />,
  fe: () => <><rect x="1.8" y="3" width="12.4" height="9" rx="1.6" /><path d="M5.5 14h5M6 6.3 4.5 7.5 6 8.7M10 6.3l1.5 1.2L10 8.7" /></>,
  be: () => <><ellipse cx="8" cy="3.8" rx="5" ry="1.8" /><path d="M3 3.8v8.4c0 1 2.2 1.8 5 1.8s5-.8 5-1.8V3.8M3 8c0 1 2.2 1.8 5 1.8s5-.8 5-1.8" /></>,
  api: () => <><path d="M5 4.5c-1.5 0-1.5 1-1.5 2S3 8 2 8c1 0 1.5.5 1.5 1.5s0 2 1.5 2M11 4.5c1.5 0 1.5 1 1.5 2S13 8 14 8c-1 0-1.5.5-1.5 1.5s0 2-1.5 2" /><path d="M6.5 8h3" /></>,
  code: () => <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />,
  preview: () => <><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>,
  test: () => <><path d="M6 2h4M6.8 2v4.2L3 12.6A1 1 0 0 0 3.9 14h8.2a1 1 0 0 0 .9-1.4L9.2 6.2V2" /><path d="M4.6 10h6.8" /></>,
  wiki: () => <><path d="M2.5 3.2c2-.8 3.8-.6 5.5.6v9.7c-1.7-1.2-3.5-1.4-5.5-.6z" /><path d="M13.5 3.2c-2-.8-3.8-.6-5.5.6v9.7c1.7-1.2 3.5-1.4 5.5-.6z" /></>,
  chat: () => <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />,
  spark: () => <><path d="M7 2.5 8.2 6 11.5 7.2 8.2 8.4 7 12 5.8 8.4 2.5 7.2 5.8 6z" /><path d="M12 10.5v3M10.5 12h3" /></>,
  phone: () => <><rect x="4.5" y="1.5" width="7" height="13" rx="1.8" /><path d="M7 12.5h2" /></>,
  desktop: () => <><rect x="1.5" y="2.5" width="13" height="8.5" rx="1.5" /><path d="M5.5 14h5M8 11v3" /></>,
  globe: () => <><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.8 1.7 2.6 3.7 2.6 6S9.8 12.3 8 14C6.2 12.3 5.4 10.3 5.4 8S6.2 3.7 8 2z" /></>,
  box: () => <><path d="M8 1.8 13.5 4.6v6.8L8 14.2l-5.5-2.8V4.6z" /><path d="M2.5 4.6 8 7.4l5.5-2.8M8 7.4v6.8" /></>,
  repo: () => <><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="6" r="1.5" /><path d="M4.5 5v6M11.5 7.5c0 2.5-3 2.5-7 3.5" /></>,
  file: () => <><path d="M4 2h5.5L12 4.5V14H4z" /><path d="M9.5 2v2.5H12" /></>,
  term: () => <><rect x="1.8" y="2.5" width="12.4" height="11" rx="1.8" /><path d="m4.5 6.5 2 1.5-2 1.5M8 10h3.5" /></>,
  search: () => <><circle cx="7" cy="7" r="4.2" /><path d="m10.2 10.2 3.3 3.3" /></>,
  check: () => <path d="m3.5 8.5 3 3 6-7" />,
  play: () => <path d="M5 3.5v9l7-4.5z" />,
  plus: () => <path d="M8 3v10M3 8h10" />,
  history: () => <><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5" /><path d="M8 5v3l2 1.5" /></>,
  team: () => <><circle cx="6" cy="5.5" r="2.3" /><path d="M1.8 13.2c.4-2.3 2.1-3.6 4.2-3.6s3.8 1.3 4.2 3.6" /><path d="M10.6 3.4a2.2 2.2 0 0 1 0 4.2M11.8 9.8c1.3.4 2.2 1.6 2.4 3.4" /></>,
  pencil: () => <path d="M10.5 2.5 13.5 5.5 6 13H3v-3z" />,
  back: () => <path d="M10 3 5 8l5 5" />,
  import: () => <><path d="M8 2v7.5M5 6.5l3 3 3-3" /><path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" /></>,
}
export type GlyphName = keyof typeof G
export const Glyph = ({ name, size = 16, stroke }: { name: GlyphName; size?: number; stroke?: number }) => {
  const Paths = G[name]
  return <Svg size={size} stroke={stroke}><Paths /></Svg>
}

/** Every step: its icon and colour token. */
export const STAGE_UI: Record<Stage, { glyph: GlyphName; tone: string }> = {
  overview: { glyph: 'overview', tone: 'var(--accent)' },
  design: { glyph: 'design', tone: 'var(--c-design)' },
  stories: { glyph: 'board', tone: 'var(--c-story)' },
  split: { glyph: 'split', tone: 'var(--c-split)' },
  build: { glyph: 'code', tone: 'var(--c-fe)' },
  code: { glyph: 'code', tone: 'var(--c-fe)' },
  preview: { glyph: 'preview', tone: 'var(--c-preview)' },
  tests: { glyph: 'test', tone: 'var(--c-test)' },
  wiki: { glyph: 'wiki', tone: 'var(--c-wiki)' },
  prompt: { glyph: 'chat', tone: 'var(--accent)' },
}
export const LAYER_UI: Record<Layer, { glyph: GlyphName; tone: string }> = {
  fe: { glyph: 'fe', tone: 'var(--c-fe)' },
  be: { glyph: 'be', tone: 'var(--c-be)' },
  api: { glyph: 'api', tone: 'var(--c-split)' },
  test: { glyph: 'test', tone: 'var(--c-test)' },
  other: { glyph: 'box', tone: 'var(--label-2)' },
}
export const ROLE_UI: Record<AgentRole, { glyph: GlyphName; tone: string }> = {
  analyst: { glyph: 'story', tone: 'var(--c-story)' },
  architect: { glyph: 'split', tone: 'var(--c-split)' },
  fe: { glyph: 'fe', tone: 'var(--c-fe)' },
  be: { glyph: 'be', tone: 'var(--c-be)' },
  tester: { glyph: 'test', tone: 'var(--c-test)' },
  writer: { glyph: 'wiki', tone: 'var(--c-wiki)' },
  consultant: { glyph: 'chat', tone: 'var(--accent)' },
}
export const PLATFORM_UI: Record<Platform, GlyphName> = { web: 'globe', mobile: 'phone', desktop: 'desktop', backend: 'be', library: 'box' }

/** A coloured tile with a white icon: a step, a layer or an agent role. */
export const Tile = ({ glyph, tone, size = 22, title }: { glyph: GlyphName; tone: string; size?: number; title?: string }) => (
  <span className="tile" style={{ background: tone, width: size, height: size, borderRadius: Math.round(size * 0.27) }} title={title}>
    <Glyph name={glyph} size={Math.round(size * 0.6)} stroke={1.8} />
  </span>
)

/** Jira's issue type icons; epic and story are not Issue types but share the look. */
export type TypeName = 'epic' | 'story' | IssueType
const TYPE_PATHS: Record<TypeName, ReactNode> = {
  epic: <path d="M9.2 1.8 4.2 9h3.6l-1 5.2 5-7.2H8.2z" fill="currentColor" stroke="none" />,
  story: <path d="M4.5 2.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v12L8 11.8l-3.5 2.7z" fill="currentColor" stroke="none" />,
  task: <path d="m3.6 8.4 2.9 2.9 6-6.6" strokeWidth={2.4} />,
  bug: <>
    <path d="M6.2 3.2 5 2M9.8 3.2 11 2M3 7.2h2M11 7.2h2M3 10.4h2M11 10.4h2M3.6 13.4 5.3 12M12.4 13.4 10.7 12" strokeWidth={1.6} />
    <path d="M8 2.8c1.3 0 2.2.8 2.3 1.9H5.7C5.8 3.6 6.7 2.8 8 2.8z" fill="currentColor" stroke="none" />
    <path d="M8 5.4c1.9 0 3.2 1.7 3.2 4.1S9.9 14 8 14s-3.2-2.1-3.2-4.5S6.1 5.4 8 5.4z" fill="currentColor" stroke="none" />
  </>,
  subtask: <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" strokeWidth={2} />,
}
export const TYPE_LABEL: Record<TypeName, string> = { epic: 'Epic', story: 'Story', task: 'Task', bug: 'Bug', subtask: 'Sub-task' }
export const TypeIcon = ({ type, size = 16 }: { type: TypeName; size?: number }) => (
  <span className={`type-icon ty-${type}`} style={{ width: size, height: size }} title={TYPE_LABEL[type]}>
    <svg width={Math.round(size * 0.75)} height={Math.round(size * 0.75)} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{TYPE_PATHS[type]}</svg>
  </span>
)

/** Six shapes of state; the same everywhere and never a text pill. */
export type Shape = 'todo' | 'run' | 'wait' | 'ok' | 'err' | 'block'
export const SHAPE_LABEL: Record<Shape, string> = { todo: 'Čeká', run: 'Pracuje', wait: 'Ke schválení', ok: 'Hotovo', err: 'Selhalo', block: 'Blokováno' }
export const shapeOf = (status: IssueStatus): Shape =>
  ({ proposed: 'wait', todo: 'todo', running: 'run', review: 'wait', done: 'ok', failed: 'err', blocked: 'block' } as const)[status]
export const StatusIcon = ({ shape, size = 16, label }: { shape: Shape; size?: number; label?: string }) => (
  <span className={`status-icon st-${shape}`} title={label ?? SHAPE_LABEL[shape]} role="img" aria-label={label ?? SHAPE_LABEL[shape]}>
    <Svg size={size} stroke={1.6}>
      {shape === 'block' ? <><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" /></>
        : shape === 'run' ? <><circle cx="8" cy="8" r="6" opacity=".25" /><path d="M8 2a6 6 0 0 1 6 6" /></>
        : <>
          <circle cx="8" cy="8" r="6" />
          {shape === 'wait' && <path d="M8 5v3.3M8 10.8v.2" />}
          {shape === 'ok' && <path d="m5.3 8.2 1.8 1.8 3.6-3.8" />}
          {shape === 'err' && <path d="m6 6 4 4M10 6l-4 4" />}
        </>}
    </Svg>
  </span>
)
