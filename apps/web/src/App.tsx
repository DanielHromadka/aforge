import { useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Project, ProjectSummary, ProvidersInfo, Stage } from '@aforge/shared'
import { api } from './api'
import { Icon, type IconName } from './icons'
import { StudioContext, StudioProvider, useStudio } from './studio'
import { AgentPanel } from './components/AgentPanel'
import { Dialog } from './components/Dialog'
import { DesignStage } from './stages/DesignStage'
import { StoriesStage } from './stages/StoriesStage'
import { BlocksStage } from './stages/BlocksStage'
import { BuildStage } from './stages/BuildStage'
import { CodeStage } from './stages/CodeStage'
import { PreviewStage } from './stages/PreviewStage'
import { TestsStage } from './stages/TestsStage'
import { AgentsView } from './stages/AgentsView'

export const STAGE_META: { id: Stage; label: string; icon: IconName }[] = [
  { id: 'design', label: 'Design', icon: 'design' },
  { id: 'stories', label: 'Zadání', icon: 'stories' },
  { id: 'blocks', label: 'Bloky', icon: 'blocks' },
  { id: 'build', label: 'Build', icon: 'build' },
  { id: 'code', label: 'Kód', icon: 'code' },
  { id: 'preview', label: 'Náhled', icon: 'preview' },
  { id: 'tests', label: 'Testy', icon: 'tests' },
]

export const App = () => {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [open, setOpen] = useState<Project | null>(null)
  const [providers, setProviders] = useState<ProvidersInfo>()
  const [creating, setCreating] = useState(false)
  const [toastMsg, setToastMsg] = useState<{ text: string; error: boolean } | null>(null)

  const toast = useCallback((text: string, error = false) => {
    setToastMsg({ text, error })
    window.setTimeout(() => setToastMsg((t) => (t?.text === text ? null : t)), error ? 7000 : 3500)
  }, [])

  const refreshList = useCallback(() => api<ProjectSummary[]>('/projects').then(setProjects), [])

  const openProject = useCallback(
    async (id: string) => {
      try {
        setOpen(await api<Project>(`/projects/${id}`))
        localStorage.setItem('aforge.lastProject', id)
      } catch (e) {
        toast((e as Error).message, true)
      }
    },
    [toast],
  )

  useEffect(() => {
    void refreshList().then(() => {
      const last = localStorage.getItem('aforge.lastProject')
      if (last) void openProject(last)
    })
    void api<ProvidersInfo>('/providers').then(setProviders)
  }, [refreshList, openProject])

  const create = async (name: string, description: string) => {
    const p = await api<Project>('/projects', { body: { name, description } })
    setCreating(false)
    await refreshList()
    await openProject(p.id)
  }

  const sidebarProjects = (
    <div className="side-section">
      <div className="side-header">
        Projekty
        <button className="side-add" title="Nový projekt" onClick={() => setCreating(true)}>
          <Icon.plus />
        </button>
      </div>
      {projects.map((p) => (
        <button key={p.id} className={`side-link ${open?.id === p.id ? 'current' : ''}`} onClick={() => void openProject(p.id)} title={p.description}>
          <Icon.folder />
          <span>{p.name}</span>
        </button>
      ))}
      {!projects.length && <div className="side-link muted">Zatím žádný projekt</div>}
    </div>
  )

  return (
    <>
      {open ? (
        <StudioProvider key={open.id} initial={open} providers={providers} toast={toast}>
          <Studio sidebarProjects={sidebarProjects} onRenamed={refreshList} />
        </StudioProvider>
      ) : (
        <div className="window">
          <div className="toolbar">
            <div className="traffic">
              <span />
              <span />
              <span />
            </div>
            <div className="toolbar-title">
              <strong>aForge</strong>
              <span>AI studio pro webové aplikace</span>
            </div>
          </div>
          <div className="window-body" style={{ gridTemplateColumns: '220px 1fr' }}>
            <aside className="sidebar">{sidebarProjects}</aside>
            <main className="content">
              <div className="empty">
                <div>
                  <Icon.sparkles size={40} />
                  <div style={{ marginTop: 10, color: 'var(--label)' }}>Vítejte v aForge</div>
                  <p>Nakreslete wireframy, popište user stories a nechte Claude Code nebo Codex aplikaci postavit, spustit a otestovat.</p>
                  <button className="btn primary" onClick={() => setCreating(true)}>
                    Nový projekt
                  </button>
                </div>
              </div>
            </main>
          </div>
          <StatusBar providers={providers} />
        </div>
      )}
      {creating && <NewProjectDialog onCancel={() => setCreating(false)} onCreate={create} />}
      {toastMsg && <div className={`toast ${toastMsg.error ? 'error' : ''}`}>{toastMsg.text}</div>}
    </>
  )
}

const Studio = ({ sidebarProjects, onRenamed }: { sidebarProjects: ReactNode; onRenamed: () => void }) => {
  const s = useStudio()
  const { project } = s
  const [agentsView, setAgentsView] = useState(false)
  const stage = agentsView ? null : s.stage
  const setStage = (st: Stage) => {
    setAgentsView(false)
    s.setStage(st)
  }
  const counts: Partial<Record<Stage, number | undefined>> = {
    design: project.screens.length,
    stories: project.stories.length,
    blocks: project.blocks.nodes.length,
    preview: project.annotations.filter((a) => a.status === 'open').length || undefined,
    tests: project.testReport?.cases.length,
  }
  const failed = project.testReport?.cases.filter((c) => c.status !== 'passed' && c.status !== 'skipped').length ?? 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const n = Number(e.key)
      if (n >= 1 && n <= STAGE_META.length) {
        e.preventDefault()
        setStage(STAGE_META[n - 1]!.id)
      }
      if (e.key === 'j') {
        e.preventDefault()
        s.setAgentOpen(!s.agentOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  return (
    <div className="window">
      <div className="toolbar">
        <div className="traffic">
          <span />
          <span />
          <span />
        </div>
        <div className="toolbar-title">
          <strong
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onBlur={(e) => {
              const name = e.currentTarget.textContent?.trim()
              if (name && name !== project.name) {
                s.update((p) => ({ ...p, name }))
                window.setTimeout(onRenamed, 600)
              }
            }}
          >
            {project.name}
          </strong>
          <span>
            {project.stack.backend === 'dotnet' ? '.NET' : project.stack.backend} · {project.stack.frontend === 'react' ? 'React' : 'Vue'} ·{' '}
            {project.stack.agent === 'codex' ? 'Codex' : 'Claude Code'}
          </span>
        </div>
        <div className="spacer" />
        <div className="segmented" role="tablist">
          {STAGE_META.map((m, i) => (
            <button key={m.id} role="tab" aria-selected={stage === m.id} className={stage === m.id ? 'active' : ''} onClick={() => setStage(m.id)} title={`${m.label} (⌘${i + 1})`}>
              {m.label}
              {counts[m.id] ? <span className="num">{counts[m.id]}</span> : null}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <button className={`tool-btn ${s.agentOpen ? 'pressed' : ''}`} onClick={() => s.setAgentOpen(!s.agentOpen)} title="Agent (⌘J)">
          <Icon.sparkles /> Agent
        </button>
      </div>
      <div className="window-body" style={{ gridTemplateColumns: `220px 1fr ${s.agentOpen ? 'auto' : '0'}` }}>
        <aside className="sidebar">
          {sidebarProjects}
          <div className="side-section">
            <div className="side-header">Fáze</div>
            {STAGE_META.map((m) => {
              const I = Icon[m.icon]
              const badge =
                m.id === 'tests' && failed ? (
                  <span className="badge red">{failed}</span>
                ) : m.id === 'build' && s.building ? (
                  <span className="dot run" />
                ) : m.id === 'preview' && s.preview.state === 'running' ? (
                  <span className="dot ok" />
                ) : counts[m.id] ? (
                  <span className="badge">{counts[m.id]}</span>
                ) : null
              return (
                <button key={m.id} className={`side-link ${stage === m.id ? 'current' : ''}`} onClick={() => setStage(m.id)}>
                  <I />
                  <span>{m.label}</span>
                  {badge}
                </button>
              )
            })}
          </div>
          <div className="side-section">
            <div className="side-header">Infrastruktura</div>
            <button className={`side-link ${agentsView ? 'current' : ''}`} onClick={() => setAgentsView(true)}>
              <Icon.sparkles />
              <span>Agenti a pipeline</span>
              {s.pipeline && (s.pipeline.status === 'running' || s.pipeline.status === 'planning') ? <span className="dot run" /> : null}
            </button>
          </div>
          <div className="side-section">
            <div className="side-header">
              Obrazovky
              <button
                className="side-add"
                title="Nová obrazovka"
                onClick={() => {
                  const id = `screen-${Math.random().toString(36).slice(2, 7)}`
                  s.update((p) => ({ ...p, screens: [...p.screens, { id, name: `Obrazovka ${p.screens.length + 1}`, width: 1280, height: 800, elements: [] }] }))
                  s.setFocus({ screenId: id })
                  setStage('design')
                }}
              >
                <Icon.plus />
              </button>
            </div>
            {project.screens.map((sc) => (
              <button
                key={sc.id}
                className={`side-link ${stage === 'design' && s.focus.screenId === sc.id ? 'current' : ''}`}
                onClick={() => {
                  s.setFocus({ screenId: sc.id })
                  setStage('design')
                }}
              >
                <Icon.screen />
                <span>{sc.name}</span>
              </button>
            ))}
          </div>
        </aside>
        <main className="content">
          {agentsView && <AgentsView />}
          {stage === 'design' && <DesignStage />}
          {stage === 'stories' && <StoriesStage />}
          {stage === 'blocks' && <BlocksStage />}
          {stage === 'build' && <BuildStage />}
          {stage === 'code' && <CodeStage />}
          {stage === 'preview' && <PreviewStage />}
          {stage === 'tests' && <TestsStage />}
        </main>
        {s.agentOpen ? <AgentPanel /> : <div />}
      </div>
      <StatusBar providers={s.providers} />
    </div>
  )
}

const StatusBar = ({ providers }: { providers?: ProvidersInfo }) => {
  const studio = useOptionalStudio()
  const p = studio?.project
  const verified = p?.stories.filter((x) => x.status === 'verified').length ?? 0
  return (
    <footer className="statusbar">
      {p && (
        <>
          <span className="item">
            {p.stories.length} stories · {verified} ověřeno
          </span>
          <span className="item">{p.screens.reduce((n, sc) => n + sc.elements.length, 0)} prvků wireframu</span>
          <span className="item">
            <span className={`dot ${studio.preview.state === 'running' ? 'ok' : studio.preview.state === 'starting' ? 'run' : studio.preview.state === 'error' ? 'err' : ''}`} />
            kontejner: {studio.preview.state}
          </span>
        </>
      )}
      <span className="spacer" />
      {providers && (
        <>
          <span className="item" title={providers.anthropicApi ? 'Konzultant volá Anthropic API' : 'Konzultant běží přes přihlášený Claude Code'}>
            <span className={`dot ${providers.claude || providers.anthropicApi ? 'ok' : 'err'}`} /> Claude {providers.anthropicApi ? 'API' : 'Code'}
          </span>
          <span className="item">
            <span className={`dot ${providers.codex ? 'ok' : ''}`} /> Codex
          </span>
          <span className="item" title={providers.runtimeImage ? 'aforge-runtime je připraven' : 'Spusťte npm run runtime:build'}>
            <span className={`dot ${providers.docker ? (providers.runtimeImage ? 'ok' : 'warn') : 'err'}`} /> Docker
          </span>
        </>
      )}
    </footer>
  )
}

// StatusBar is used both inside and outside a project.
const useOptionalStudio = () => useContext(StudioContext)

const NewProjectDialog = ({ onCancel, onCreate }: { onCancel: () => void; onCreate: (name: string, description: string) => Promise<void> }) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog onClose={onCancel}>
      <h3>Nový projekt</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Stručně popište aplikaci – agent z popisu navrhne první user stories.
      </p>
      <div className="form-row">
        <label>Název</label>
        <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Např. Rezervace zasedaček" />
      </div>
      <div className="form-row top">
        <label>Popis</label>
        <textarea className="field" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Kdo aplikaci používá, co v ní dělá, jaké má hlavní části…" />
      </div>
      {error && <div style={{ color: 'var(--red)' }}>{error}</div>}
      <div className="dialog-actions">
        <button className="btn" onClick={onCancel}>
          Zrušit
        </button>
        <button
          className="btn primary"
          disabled={!name.trim() || busy}
          onClick={() => {
            setBusy(true)
            onCreate(name, description).catch((e: Error) => {
              setError(e.message)
              setBusy(false)
            })
          }}
        >
          Vytvořit
        </button>
      </div>
    </Dialog>
  )
}
