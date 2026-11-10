// Shared pieces of the work views: an issue row, a story card and the team's live activity.
import { useState, type ReactNode } from 'react'
import { LAYER_LABEL, LAYERS, reposOf, roleOfIssue, ROLE_NAME, storyStage, type AgentRole, type AgentRun, type Issue, type Layer, type Project, type Story, type StoryStage } from '@aforge/shared'
import { useStudio } from '../studio'
import { PlanningSummary } from './Planning'
import { isLive } from './AgentRuns'
import { LAYER_UI, PLATFORM_UI, ROLE_UI, shapeOf, StatusIcon, Tile, TypeIcon, Glyph, type Shape } from './Glyphs'

export const STORY_STAGE_UI: Record<StoryStage, { label: string; glyph: Parameters<typeof Tile>[0]['glyph']; tone: string }> = {
  story: { label: 'Story', glyph: 'story', tone: 'var(--c-story)' },
  split: { label: 'Rozpad', glyph: 'split', tone: 'var(--c-split)' },
  build: { label: 'Implementace', glyph: 'code', tone: 'var(--c-fe)' },
  preview: { label: 'Náhled', glyph: 'preview', tone: 'var(--c-preview)' },
  tests: { label: 'Testy', glyph: 'test', tone: 'var(--c-test)' },
  done: { label: 'Hotovo', glyph: 'check', tone: 'var(--green)' },
}

export const issuesOf = (p: Project, storyId: string) => (p.issues ?? []).filter((i) => i.storyId === storyId)
export const openBugs = (p: Project, storyId?: string) => (p.issues ?? []).filter((i) => i.type === 'bug' && i.status !== 'done' && (!storyId || i.storyId === storyId))
export const stageOf = (p: Project, s: Story) => storyStage(p, s)
export const repoName = (p: Project, id: string) => reposOf(p).find((r) => r.id === id)?.name ?? id

/** The project's live runs, newest first. */
export const projectRuns = (runs: AgentRun[], p: Project) => {
  const root = p.session?.projectId ?? p.id
  return runs.filter((r) => r.projectId === p.id || r.rootProjectId === root)
}

/** A row of a task or bug: type, key, title, layer and repository, state. */
export const IssueRow = ({ issue, selected, onClick, actions }: { issue: Issue; selected?: boolean; onClick?: () => void; actions?: React.ReactNode }) => {
  const s = useStudio()
  const layer = LAYER_UI[issue.layer]
  const repo = reposOf(s.project).find((r) => r.id === issue.repoId)
  return (
    <div className={`issue-row ${selected ? 'selected' : ''} ${onClick ? 'clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => { if (onClick && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick() } }}>
      <TypeIcon type={issue.type} />
      <span className="key">{issue.id}</span>
      <span className="issue-title">{issue.title}</span>
      <PlanningSummary kind="issue" id={issue.id} />
      <span className="issue-meta">
        <Tile glyph={layer.glyph} tone={layer.tone} size={18} title={ROLE_NAME[roleOfIssue(s.project, issue)]} />
        {repo && reposOf(s.project).length > 1 && <span className="muted repo-name"><Glyph name={PLATFORM_UI[repo.platform]} size={12} />{repo.name}</span>}
      </span>
      {actions}
      <StatusIcon shape={shapeOf(issue.status)} />
    </div>
  )
}

/** Who of the team works on what right now. */
export const TEAM: AgentRole[] = ['analyst', 'architect', 'fe', 'be', 'tester', 'writer']
export const TeamList = ({ runs }: { runs: AgentRun[] }) => (
  <div className="team-list">
    {TEAM.map((role) => {
      const live = runs.find((r) => r.role === role && isLive(r))
      const last = runs.find((r) => r.role === role)
      return (
        <div key={role} className="team-row">
          <Tile glyph={ROLE_UI[role].glyph} tone={ROLE_UI[role].tone} size={26} />
          <div className="team-main">
            <strong>{ROLE_NAME[role]}</strong>
            <span className="muted">{live ? live.step : last && last.state === 'failed' ? `Selhalo · ${last.step}` : 'Volný'}</span>
          </div>
          <StatusIcon shape={live ? 'run' : last?.state === 'failed' ? 'err' : 'todo'} label={live ? 'Pracuje' : 'Volný'} />
        </div>
      )
    })}
  </div>
)

// ---- filtering and collapsing long task lists -----------------------------------------------------

export type StateFilter = 'all' | 'open' | 'review' | 'running' | 'failed' | 'done'
export interface IssueFilter { q: string; state: StateFilter; layer: Layer | 'all'; repo: string; story: string }
export const NO_FILTER: IssueFilter = { q: '', state: 'all', layer: 'all', repo: 'all', story: 'all' }
const STATE_LABEL: Record<StateFilter, string> = { all: 'Všechny stavy', open: 'Nedokončené', review: 'Ke schválení', running: 'Pracuje se', failed: 'Selhané', done: 'Hotové' }

export const matchesFilter = (i: Issue, f: IssueFilter) => {
  const q = f.q.trim().toLocaleLowerCase('cs')
  if (q && !`${i.id} ${i.title} ${i.description}`.toLocaleLowerCase('cs').includes(q)) return false
  if (f.layer !== 'all' && i.layer !== f.layer) return false
  if (f.repo !== 'all' && i.repoId !== f.repo) return false
  if (f.story !== 'all' && i.storyId !== f.story) return false
  switch (f.state) {
    case 'open': return i.status !== 'done'
    case 'review': return i.status === 'review' || i.status === 'proposed'
    case 'running': return i.status === 'running'
    case 'failed': return i.status === 'failed' || i.status === 'blocked'
    case 'done': return i.status === 'done'
    default: return true
  }
}
export const isFiltered = (f: IssueFilter, base = NO_FILTER) => (Object.keys(f) as (keyof IssueFilter)[]).some((k) => f[k] !== base[k])

/** Search and selects; only the dimensions that have a choice in this list are shown. */
export const IssueFilterBar = ({ filter, onChange, issues, stories, base = NO_FILTER }: { filter: IssueFilter; onChange: (f: IssueFilter) => void; issues: Issue[]; stories?: boolean; base?: IssueFilter }) => {
  const s = useStudio()
  const layers = LAYERS.filter((l) => issues.some((i) => i.layer === l))
  const repos = reposOf(s.project).filter((r) => issues.some((i) => i.repoId === r.id))
  const storyIds = [...new Set(issues.map((i) => i.storyId).filter((x): x is string => !!x))]
  const set = (patch: Partial<IssueFilter>) => onChange({ ...filter, ...patch })
  return (
    <div className="filter-bar">
      <span className="filter-search"><Glyph name="search" size={13} /><input type="search" placeholder="Hledat" value={filter.q} onChange={(e) => set({ q: e.target.value })} aria-label="Hledat v taskách" /></span>
      <select className="field" aria-label="Stav" value={filter.state} onChange={(e) => set({ state: e.target.value as StateFilter })}>
        {(Object.keys(STATE_LABEL) as StateFilter[]).map((k) => <option key={k} value={k}>{STATE_LABEL[k]}</option>)}
      </select>
      {layers.length > 1 && <select className="field" aria-label="Vrstva" value={filter.layer} onChange={(e) => set({ layer: e.target.value as IssueFilter['layer'] })}>
        <option value="all">Všechny vrstvy</option>
        {layers.map((l) => <option key={l} value={l}>{LAYER_LABEL[l]}</option>)}
      </select>}
      {repos.length > 1 && <select className="field" aria-label="Repozitář" value={filter.repo} onChange={(e) => set({ repo: e.target.value })}>
        <option value="all">Všechny repozitáře</option>
        {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>}
      {stories && storyIds.length > 1 && <select className="field" aria-label="Story" value={filter.story} onChange={(e) => set({ story: e.target.value })}>
        <option value="all">Všechny stories</option>
        {storyIds.map((id) => <option key={id} value={id}>{id} {s.project.stories.find((x) => x.id === id)?.title ?? ''}</option>)}
      </select>}
      {isFiltered(filter, base) && <button className="link-btn small" onClick={() => onChange(base)}>Zrušit filtr</button>}
    </div>
  )
}

/** How many tasks are in each state, as the status shapes with counts. */
export const StatusSummary = ({ issues }: { issues: Issue[] }) => {
  const counts = new Map<Shape, number>()
  for (const i of issues) counts.set(shapeOf(i.status), (counts.get(shapeOf(i.status)) ?? 0) + 1)
  const order: Shape[] = ['run', 'wait', 'err', 'block', 'todo', 'ok']
  return <span className="status-summary">{order.filter((k) => counts.has(k)).map((k) => <span key={k} className="row-gap"><StatusIcon shape={k} size={13} />{counts.get(k)}</span>)}</span>
}

/** Collapsed groups are a per-browser convenience, remembered per project. */
const collapsedKey = (projectId: string) => `aforge.collapsed.${projectId}`
export const useCollapsed = () => {
  const s = useStudio()
  const read = () => { try { return new Set<string>(JSON.parse(localStorage.getItem(collapsedKey(s.project.id)) ?? '[]')) } catch { return new Set<string>() } }
  const [collapsed, setCollapsed] = useState(read)
  const toggle = (id: string, open: boolean) => setCollapsed((c) => {
    const next = new Set(c)
    if (open) next.delete(id); else next.add(id)
    try { localStorage.setItem(collapsedKey(s.project.id), JSON.stringify([...next])) } catch { /* Storage may be unavailable. */ }
    return next
  })
  return { isOpen: (id: string, byDefault = true) => (collapsed.has(id) ? false : collapsed.has(`+${id}`) ? true : byDefault), toggle: (id: string, open: boolean) => { toggle(id, open); toggle(`+${id}`, !open) } }
}

/** A collapsible group of tasks: chevron, title, count and the state summary in the header. */
export const IssueGroup = ({ title, issues, open, onToggle, actions, children }: { title: ReactNode; issues: Issue[]; open: boolean; onToggle: (open: boolean) => void; actions?: ReactNode; children: ReactNode }) => (
  <div className={`issue-group ${open ? 'open' : ''}`}>
    <div className="issue-group-head">
      <button className="group-toggle" aria-expanded={open} onClick={() => onToggle(!open)}>
        <span className="chev" aria-hidden>›</span>
        <span className="group-title">{title}</span>
        <span className="muted small num">{issues.length}</span>
        {!open && <StatusSummary issues={issues} />}
      </button>
      {actions}
    </div>
    {open && <div className="issue-group-body">{children}</div>}
  </div>
)
