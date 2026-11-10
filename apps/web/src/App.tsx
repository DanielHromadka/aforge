import { useCallback, useContext, useEffect, useState } from 'react'
import { workflowOf, workflowPreset, WORKFLOW_PRESETS, type AuthState, type WorkflowStep, type Project, type ProvidersInfo } from '@aforge/shared'
import { AuthContext } from './auth'
import { navigate, usePath } from './router'
import { Home, LoginPage } from './home/Home'
import { api } from './api'
import { Icon } from './icons'
import { StudioContext, StudioProvider, useStudio } from './studio'
import { AgentPanel } from './components/AgentPanel'
import { Glyph, STAGE_UI } from './components/Glyphs'
import { DesignInspector, DesignStage, LayersPanel } from './stages/DesignStage'
import { WorkflowEditor } from './components/WorkflowEditor'
import { PromptStage } from './stages/PromptStage'
import { IdeStage } from './stages/IdeStage'
import { StepPrompt } from './components/PromptPanels'
import { OverviewStage } from './stages/OverviewStage'
import { BoardStage } from './stages/BoardStage'
import { SplitStage } from './stages/SplitStage'
import { ImplementStage } from './stages/ImplementStage'
import { WikiStage } from './stages/WikiStage'
import { CodeStage } from './stages/CodeStage'
import { PreviewStage } from './stages/PreviewStage'
import { TestsStage } from './stages/TestsStage'
import { AgentsView } from './stages/AgentsView'
import { SessionsView } from './stages/SessionsView'
import { ArchivedStage, ArchivedAgent, ArchivedActivity } from './stages/ArchivedStage'
import { PlanningNotificationsButton, PlanningNotificationsProvider } from './components/PlanningNotifications'

export const App = () => {
  const [auth, setAuth] = useState<AuthState>()
  const [providers, setProviders] = useState<ProvidersInfo>()
  const [toastMsg, setToastMsg] = useState<{ text: string; error: boolean } | null>(null)
  const path = usePath()

  const toast = useCallback((text: string, error = false) => {
    setToastMsg({ text, error })
    window.setTimeout(() => setToastMsg((t) => (t?.text === text ? null : t)), error ? 7000 : 3500)
  }, [])

  const loadAuth = useCallback(() => api<AuthState>('/auth/me').then(setAuth, () => setAuth({ enabled: true, user: null })), [])
  useEffect(() => {
    void loadAuth()
    window.addEventListener('aforge:signed-out', loadAuth)
    return () => window.removeEventListener('aforge:signed-out', loadAuth)
  }, [loadAuth])
  useEffect(() => { if (auth?.user) void api<ProvidersInfo>('/providers').then(setProviders) }, [auth?.user])
  useEffect(() => { if (auth?.user && path === '/') navigate('/projects', true) }, [auth?.user, path])

  if (!auth) return null
  if (!auth.user) return <LoginPage />
  const editing = path.match(/^\/p\/([^/]+)/)?.[1]
  return (
    <AuthContext.Provider value={{ ...auth, user: auth.user }}>
      <PlanningNotificationsProvider key={auth.user.id} toast={toast}>
      {editing ? <Editor id={decodeURIComponent(editing)} providers={providers} toast={toast} /> : <Home path={path} toast={toast} />}
      {toastMsg && <div role={toastMsg.error ? 'alert' : 'status'} className={`toast ${toastMsg.error ? 'error' : ''}`}>{toastMsg.text}</div>}
      </PlanningNotificationsProvider>
    </AuthContext.Provider>
  )
}

/** Loads the project or session of the URL; another session replaces the URL, not the page. */
const Editor = ({ id, providers, toast }: { id: string; providers?: ProvidersInfo; toast: (text: string, error?: boolean) => void }) => {
  const [open, setOpen] = useState<Project | null>(null)
  useEffect(() => {
    let live = true
    api<Project>(`/projects/${id}`).then((next) => {
      if (!live) return
      setOpen(next)
      localStorage.setItem(`aforge.lastSession.${next.session?.projectId ?? next.id}`, next.id)
    }, (e: Error) => { toast(e.message, true); navigate('/projects', true) })
    return () => { live = false }
  }, [id, toast])
  if (!open || open.id !== id) return null
  return (
    <StudioProvider key={`${open.id}:${open.session?.archivedAt ?? ''}`} initial={open} providers={providers} toast={toast}>
      <Studio onOpen={async (next) => {
        if (next !== id) return navigate(`/p/${next}`)
        // The same id after archiving: reload to get the frozen state.
        setOpen(await api<Project>(`/projects/${next}`))
      }} />
    </StudioProvider>
  )
}

const Studio = ({ onOpen }: { onOpen: (id: string) => Promise<void> }) => {
  const s = useStudio()
  const { project } = s
  const { view, setView } = s
  const [workflowEditor, setWorkflowEditor] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const workflow = workflowOf(project)
  const archived = !!(project.session?.snapshot || project.session?.archivedAt)
  const setStep = (step: WorkflowStep) => { setPromptOpen(false); s.setStep(step.id) }
  const activeIndex = workflow.steps.findIndex((x) => x.id === s.activeStep.id)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const n = Number(e.key)
      if (n >= 1 && n <= workflow.steps.length) {
        e.preventDefault()
        setStep(workflow.steps[n - 1]!)
      }
      if (e.key === 'j') {
        e.preventDefault()
        s.setAgentOpen(!s.agentOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s, workflow.steps])

  const body = () => {
    if (view === 'history') return <main className="content card-pane flush"><SessionsView onOpen={onOpen} /></main>
    if (view === 'agents') return <main className="content card-pane flush">{archived ? <ArchivedActivity /> : <AgentsView />}</main>
    if (archived) return <main className="content card-pane flush"><ArchivedStage /></main>
    switch (s.stage) {
      case 'overview': return <OverviewStage />
      case 'design': return (
        <div className="design-layout">
          <aside className="card-pane flush"><LayersPanel /></aside>
          <main className="content card-pane flush"><DesignStage /></main>
          <aside className="card-pane flush"><DesignInspector /></aside>
        </div>
      )
      case 'stories': return <main className="content card-pane flush"><BoardStage /></main>
      case 'split': return <main className="content card-pane flush"><SplitStage /></main>
      case 'build': return <main className="content card-pane flush"><ImplementStage /></main>
      case 'code': return <main className="content card-pane flush"><CodeStage /></main>
      case 'preview': return <main className="content card-pane flush"><PreviewStage /></main>
      case 'tests': return <main className="content card-pane flush"><TestsStage /></main>
      case 'wiki': return <main className="content card-pane flush"><WikiStage /></main>
      case 'prompt': return <main className="content card-pane flush"><PromptStage /></main>
      case 'ide': return <main className="ide-host"><IdeStage /></main>
    }
  }

  return (
    <div className="window editor">
      <header className="toolbar">
        <button className="tool-btn" onClick={() => void s.flush().then(() => navigate('/projects'))} title="Projekty"><Icon.back /></button>
        <div className="toolbar-title">
          <strong
            contentEditable={!s.readOnly}
            suppressContentEditableWarning
            spellCheck={false}
            onBlur={(e) => {
              const name = e.currentTarget.textContent?.trim()
              if (name && name !== project.name) s.update((p) => ({ ...p, name }))
            }}
          >
            {project.name}
          </strong>
          <span>
            {project.session?.snapshot?.name ?? project.session?.name ?? 'Session 1'}
            {s.readOnly ? ' · jen pro čtení' : ''}
          </span>
        </div>
        <nav className="ladder" aria-label="Kroky workflow"><ol>
          {workflow.steps.map((step, i) => {
            const ui = STAGE_UI[step.kind]
            const current = view === 'step' && s.activeStep.id === step.id
            return (
              <li key={step.id} className={i < activeIndex ? 'passed' : ''}>
                <button className={current ? 'active' : ''} style={{ ['--tone' as string]: ui.tone }} aria-current={current ? 'step' : undefined} onClick={() => setStep(step)} title={`${step.label} (⌘${i + 1})`}>
                  <span className="rung-dot"><Glyph name={ui.glyph} size={13} stroke={1.8} /></span>
                  <span>{step.label}</span>
                </button>
              </li>
            )
          })}
        </ol></nav>
        <div className="toolbar-actions">
          <ModeSwitch />
          <PlanningNotificationsButton beforeOpen={s.flush} />
          {view === 'step' && <div className="menu-anchor">
            <button className={`tool-btn ${promptOpen ? 'pressed' : ''} ${s.activeStep.prompt.trim() ? 'has-prompt' : ''}`} onClick={() => setPromptOpen(!promptOpen)} title="Prompt kroku"><Glyph name="pencil" /></button>
            {promptOpen && <div className="popover" onKeyDown={(e) => e.key === 'Escape' && setPromptOpen(false)}><StepPrompt /></div>}
          </div>}
          {/* The mode switch names the preset; the editor stays one icon so the ladder keeps its room. */}
          <button className="tool-btn" onClick={() => setWorkflowEditor(true)} title={`Workflow: ${workflow.preset === 'custom' ? 'Vlastní' : WORKFLOW_PRESETS[workflow.preset].label}`} aria-label="Upravit workflow"><Glyph name="settings" /></button>
          <button className={`tool-btn ${view === 'history' ? 'pressed' : ''}`} onClick={() => setView(view === 'history' ? 'step' : 'history')} title="Sessions a historie"><Glyph name="history" /></button>
          <button className={`tool-btn ${view === 'agents' ? 'pressed' : ''}`} onClick={() => setView(view === 'agents' ? 'step' : 'agents')} title="Agenti a pipeline"><Glyph name="team" /></button>
          <button className={`tool-btn ${s.agentOpen ? 'pressed' : ''}`} onClick={() => s.setAgentOpen(!s.agentOpen)} title="Konzultant (⌘J)">
            <Icon.sparkles /> Agent
          </button>
        </div>
      </header>
      <div className={`editor-body ${s.agentOpen ? 'with-agent' : ''}`}>
        {body()}
        {s.agentOpen && <div className="card-pane flush agent-drawer">{archived ? <ArchivedAgent /> : <AgentPanel />}</div>}
      </div>
      {workflowEditor && <WorkflowEditor onClose={() => setWorkflowEditor(false)} />}
      <StatusBar providers={s.providers} />
    </div>
  )
}

/** Studio, IDE or Vibe: three faces of the same session; switching keeps every prompt and result. */
const MODES = [['enterprise', 'Studio'], ['ide', 'IDE'], ['vibe', 'Vibe']] as const
const ModeSwitch = () => {
  const s = useStudio()
  const current = workflowOf(s.project).preset
  if (s.project.session?.snapshot || s.project.session?.archivedAt) return null
  return (
    <div className="segmented mode-switch" role="group" aria-label="Režim">
      {MODES.map(([preset, label]) => (
        <button key={preset} className={current === preset ? 'active' : ''} disabled={s.readOnly} aria-pressed={current === preset} title={WORKFLOW_PRESETS[preset].description}
          onClick={() => {
            if (current === preset) return
            const workflow = workflowPreset(preset, workflowOf(s.project))
            s.update((p) => ({ ...p, workflow }))
            s.setStep(workflow.steps[0]!.id)
          }}>{label}</button>
      ))}
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
          <span className="item">
            {p.screens.length} obrazovek z Figmy · {p.screens.reduce((n, sc) => n + sc.elements.filter((e) => e.work).length, 0)} rozpracovaných prvků
          </span>
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
