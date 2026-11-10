// Studio state: the open project (saved with a short debounce), what the user focuses, the agent
// thread and the live logs from the server's event stream.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { workflowOf, type WorkflowStep, type ChatMessage, type PipelineRun, type PreviewStatus, type Project, type PromptSection, type ProvidersInfo, type Stage } from '@aforge/shared'
import { api, useProjectEvents, type HubEvent } from './api'
import { navigate, usePath } from './router'
import { MarkdownProjectContext } from './markdownContext'

export interface Route {
  view: 'step' | 'history' | 'agents'
  step?: string
  item?: string
}
const parseRoute = (p: string): Route => {
  const [, , , step, item] = p.split('/').map((x) => decodeURIComponent(x))
  if (step === 'history' || step === 'agents') return { view: step }
  return { view: 'step', step: step || undefined, item: item || undefined }
}

export interface Focus {
  screenId?: string
  elementId?: string
  storyId?: string
  /** The task or bug open in the Implementation step. */
  issueId?: string
  wikiPage?: string
  /** The test open in the Tests step. */
  testId?: string
  filePath?: string
  /** Repository of the open file; the workspace when absent. */
  repo?: string
}

export interface LogLine {
  kind: string
  text: string
  /** The task or bug the line belongs to. */
  issueId?: string
}

interface Studio {
  project: Project
  update: (fn: (p: Project) => Project) => void
  flush: () => Promise<boolean>
  readOnly: boolean
  reload: () => Promise<void>
  stage: Stage
  /** A step of the workflow, or the session history or agents instead of it. */
  view: Route['view']
  setView: (view: Route['view']) => void
  activeStep: WorkflowStep
  setStep: (id: string) => void
  setStepPrompt: (text: string) => void
  setStage: (s: Stage) => void
  focus: Focus
  setFocus: (f: Focus) => void
  providers?: ProvidersInfo
  chat: ChatMessage[]
  setChat: (c: ChatMessage[]) => void
  agentBusy: boolean
  /** The request in flight, shown in the thread before the agent answers. */
  pendingText: string
  /** `inline`: the answer shows where it was asked (the IDE composer), so the side panel stays closed. */
  askAgent: (req: { text?: string; intent?: string; anchor?: string; inline?: boolean }) => Promise<void>
  /** Runs a task, story, breakdown or wiki action and reloads the model. */
  act: (path: string, body?: unknown) => Promise<boolean>
  buildLog: LogLine[]
  building: boolean
  setBuilding: (b: boolean) => void
  preview: PreviewStatus
  previewLog: string
  testsLog: LogLine[]
  testsRunning: boolean
  setTestsRunning: (b: boolean) => void
  toast: (text: string, error?: boolean) => void
  agentOpen: boolean
  setAgentOpen: (b: boolean) => void
  pipeline: PipelineRun | null
  setPipeline: (r: PipelineRun | null) => void
  buildPart: BuildPart
  setBuildPart: (p: BuildPart) => void
  /** The section whose accompanying prompt the right panel edits. */
  section: PromptSection
  /** The step Claude is writing right now (stories, blocks or the implementation prompt). */
  generating: GenerateStep | null
  generate: (step: GenerateStep, storyIds?: string[]) => Promise<void>
}

export type BuildPart = 'blocks' | 'plan'
export type GenerateStep = 'stories' | 'reorganize' | 'split' | 'blocks' | 'plan' | 'wiki'
export const STEP_LABEL: Record<GenerateStep, string> = { stories: 'epicy a stories', reorganize: 'návrh reorganizace', split: 'rozpad na tasky', blocks: 'architekturu', plan: 'implementační prompt', wiki: 'změny wiki' }

export const StudioContext = createContext<Studio | null>(null)

export const useStudio = () => {
  const s = useContext(StudioContext)
  if (!s) throw new Error('useStudio outside StudioProvider')
  return s
}

export const StudioProvider = ({
  initial,
  providers,
  toast,
  children,
}: {
  initial: Project
  providers?: ProvidersInfo
  toast: (text: string, error?: boolean) => void
  children: ReactNode
}) => {
  const [project, setProject] = useState(initial)
  const readOnly = !!(project.session?.snapshot || project.session?.archivedAt) || project.role === 'viewer'
  // Where the user is lives in the URL: /p/<id>/<step>/<item>, or /p/<id>/history and /p/<id>/agents. The item
  // is the open story (Stories), task (Implementation) or wiki page, so a link or the back button lands there.
  const path = usePath()
  const [route, setRoute] = useState<Route>(() => {
    const parsed = parseRoute(location.pathname)
    return parsed.step ? parsed : { ...parsed, step: localStorage.getItem(`aforge.step.${initial.id}`) ?? workflowOf(initial).steps[0]!.id }
  })
  const lastUrl = useRef('')
  useEffect(() => {
    if (path === lastUrl.current || !path.startsWith(`/p/${initial.id}`)) return
    const parsed = parseRoute(path)
    if (parsed.step || parsed.view !== 'step') setRoute((r) => ({ ...parsed, step: parsed.step ?? r.step }))
  }, [path, initial.id])
  useEffect(() => {
    const url = `/p/${initial.id}/${route.view === 'step' ? route.step : route.view}${route.view === 'step' && route.item ? `/${encodeURIComponent(route.item)}` : ''}`
    if (url === location.pathname) return
    // Opening the editor without a step only completes the address; real moves become history entries.
    const replace = location.pathname.split('/').filter(Boolean).length <= 2
    lastUrl.current = url
    navigate(url, replace)
  }, [route, initial.id])
  const workflow = workflowOf(project)
  const activeStep = workflow.steps.find((s) => s.id === route.step) ?? workflow.steps[0]!
  const stage = activeStep.kind
  const focusRef = useRef<Focus>({ screenId: initial.screens[0]?.id })
  const itemOf = (kind: Stage, f: Focus) => (kind === 'stories' ? f.storyId : kind === 'build' ? f.issueId : kind === 'wiki' ? f.wikiPage : kind === 'tests' ? f.testId : undefined)
  /** From the ladder: the step itself, without the story or task opened there before. */
  const setStep = useCallback((id: string) => {
    localStorage.setItem(`aforge.step.${initial.id}`, id)
    setRoute({ view: 'step', step: id })
  }, [initial.id])
  /** From inside a view: go to the step and keep what the focus says is open there. */
  const setStage = (kind: Stage) => {
    const step = workflow.steps.find((s) => s.kind === kind)
    if (!step) return
    localStorage.setItem(`aforge.step.${initial.id}`, step.id)
    setRoute({ view: 'step', step: step.id, item: itemOf(kind, focusRef.current) })
  }
  const setView = useCallback((view: Route['view']) => setRoute((r) => ({ ...r, view })), [])
  const [buildPart, setBuildPart] = useState<BuildPart>(() => (localStorage.getItem('aforge.buildPart') === 'plan' ? 'plan' : 'blocks'))
  const [generating, setGenerating] = useState<GenerateStep | null>(null)
  const ownGeneration = useRef(false)
  const [focusState, setFocusState] = useState<Focus>(focusRef.current)
  // The open story, task or wiki page of the current step comes from the URL; the rest of the focus is local.
  const focus = useMemo<Focus>(() => ({
    ...focusState,
    ...(stage === 'stories' ? { storyId: route.item } : stage === 'build' ? { issueId: route.item } : stage === 'wiki' ? { wikiPage: route.item } : stage === 'tests' ? { testId: route.item } : {}),
  }), [focusState, stage, route.item])
  const setFocus = useCallback((f: Focus) => {
    focusRef.current = f
    setFocusState(f)
    const item = itemOf(stage, f)
    setRoute((r) => (r.view === 'step' && r.item !== item ? { ...r, item } : r))
  }, [stage])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [agentBusy, setAgentBusy] = useState(false)
  const [pendingText, setPendingText] = useState('')
  const [buildLog, setBuildLog] = useState<LogLine[]>([])
  const [building, setBuilding] = useState(false)
  const [preview, setPreview] = useState<PreviewStatus>({ state: 'idle', log: '' })
  const [previewLog, setPreviewLog] = useState('')
  const [testsLog, setTestsLog] = useState<LogLine[]>([])
  const [testsRunning, setTestsRunning] = useState(false)
  const [pipeline, setPipeline] = useState<PipelineRun | null>(null)
  const [agentOpen, setAgentOpen] = useState(() => localStorage.getItem('aforge.agentOpen') === '1')

  const pending = useRef<Project | null>(null)
  const timer = useRef<number>(0)

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    const next = pending.current
    pending.current = null
    if (next) {
      // Histories and attachment metadata are server-owned and can grow independently of the editable form.
      const { descriptionHistory: _history, attachments: _attachments, planning: _planning, storyReviews: _reviews, storyArchive: _archive, ...editable } = next
      try { await api(`/projects/${next.id}`, { method: 'PUT', body: editable }) }
      catch (e) { pending.current ??= next; toast((e as Error).message, true); return false }
    }
    return true
  }, [toast])

  const update = useCallback(
    (fn: (p: Project) => Project) => {
      if (readOnly) return
      setProject((p) => {
        const next = fn(p)
        pending.current = next
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => void flush(), 400)
        return next
      })
    },
    [flush, readOnly],
  )

  const reload = useCallback(async () => {
    if (pending.current) return
    setProject(await api<Project>(`/projects/${initial.id}`))
  }, [initial.id])

  useEffect(() => {
    localStorage.setItem(`aforge.stage.${initial.id}`, stage)
  }, [stage, initial.id])

  useEffect(() => {
    localStorage.setItem('aforge.agentOpen', agentOpen ? '1' : '0')
  }, [agentOpen])

  useEffect(() => {
    localStorage.setItem('aforge.buildPart', buildPart)
  }, [buildPart])

  // The result goes into the local model as well, so the next autosave carries it instead of undoing it.
  const generate = useCallback(
    async (step: GenerateStep, storyIds?: string[]) => {
      if (readOnly || !(await flush())) return
      setGenerating(step)
      ownGeneration.current = true
      try {
        const r = await api<{ patch: Partial<Project>; notes?: string }>(`/projects/${initial.id}/generate/${step}`, { body: { storyIds } })
        update((p) => ({ ...p, ...r.patch }))
        toast(r.notes || `Agent připravil ${STEP_LABEL[step]}.`)
      } catch (e) {
        toast((e as Error).message, true)
      } finally {
        ownGeneration.current = false
        setGenerating(null)
      }
    },
    [flush, update, initial.id, toast, readOnly],
  )

  const setStepPrompt = (text: string) => update((p) => {
    const w = workflowOf(p)
    return { ...p, workflow: { ...w, steps: w.steps.map((step) => step.id === activeStep.id ? { ...step, prompt: text } : step) },
      ...(activeStep.kind !== 'build' && activeStep.kind !== 'prompt' && activeStep.kind !== 'overview' && activeStep.kind !== 'ide' ? { prompts: { ...p.prompts, [activeStep.kind]: text } } : {}) }
  })

  const section: PromptSection = stage === 'build' ? buildPart : stage === 'overview' || stage === 'ide' ? 'prompt' : stage

  useEffect(() => {
    void api<ChatMessage[]>(`/projects/${initial.id}/chat`).then(setChat)
    void api<PreviewStatus>(`/projects/${initial.id}/preview`).then((s) => {
      setPreview(s)
      setPreviewLog(s.log)
    })
    void api<{ running: boolean }>(`/projects/${initial.id}/build`).then((b) => setBuilding(b.running))
    void api<{ running: boolean }>(`/projects/${initial.id}/tests`).then((b) => setTestsRunning(b.running))
    void api<{ running: boolean; step?: GenerateStep }>(`/projects/${initial.id}/generate`).then((b) => setGenerating(b.step ?? null))
    void api<{ events: HubEvent[] }>(`/projects/${initial.id}/session-record`).then((r) => {
      setBuildLog(r.events.filter((e) => e.channel === 'build').map((e) => ({ kind: e.kind, text: e.text, issueId: (e.data as { issueId?: string } | undefined)?.issueId })))
      setTestsLog(r.events.filter((e) => e.channel === 'tests').map((e) => ({ kind: e.kind, text: e.text })))
    })
    void api<PipelineRun | Record<string, never>>(`/projects/${initial.id}/pipeline`).then((r) => setPipeline('id' in r ? (r as PipelineRun) : null))
    return () => void flush()
  }, [initial.id, flush])

  useProjectEvents(readOnly ? undefined : initial.id, (e: HubEvent) => {
    if (e.channel === 'project' || (e.channel === 'session' && e.kind === 'archived')) void reload()
    // Another tab can generate too: its steps show here as busy, and its end clears them (the result comes by reload).
    if (e.channel === 'generate' && !ownGeneration.current) {
      if (e.kind === 'start') setGenerating(e.text as GenerateStep)
      else {
        setGenerating(null)
        void reload()
      }
    }
    if (e.channel === 'pipeline') setPipeline(e.data as PipelineRun)
    if (e.channel === 'ide' && e.kind === 'error') toast(e.text, true)
    // Task runs keep their own lines; a whole-project build starts its log afresh.
    const issueId = (e.data as { issueId?: string } | undefined)?.issueId
    if (e.channel === 'build' && e.kind === 'start' && !issueId) setBuilding(true)
    if (e.channel === 'build') {
      setBuildLog((l) => [...(e.kind === 'start' && !issueId ? [] : l.slice(-4000)), { kind: e.kind, text: e.text, issueId }])
      if (e.kind === 'done' || e.kind === 'error') {
        if (!issueId) setBuilding(false)
        toast(e.text, e.kind === 'error')
      }
    }
    if (e.channel === 'preview') {
      if (e.kind === 'log') setPreviewLog((l) => (l + e.text + '\n').slice(-60_000))
      if (e.kind === 'status') {
        const status = e.data as PreviewStatus
        if (status.log === '') setPreviewLog('')
        setPreview((p) => ({ ...p, ...status, log: p.log }))
      }
    }
    if (e.channel === 'tests') {
      setTestsLog((l) => [...(e.kind === 'start' ? [] : l.slice(-2000)), { kind: e.kind, text: e.text }])
      if (e.kind === 'done' || e.kind === 'error') {
        setTestsRunning(false)
        toast(e.text, e.kind === 'error')
      }
    }
  })

  const askAgent = useCallback(
    async (req: { text?: string; intent?: string; anchor?: string; inline?: boolean }) => {
      if (readOnly || !(await flush())) return
      setAgentBusy(true)
      setPendingText(req.text ?? '')
      // A thread anchored to a story shows in its detail, not in the side panel.
      if (!req.anchor && !req.inline) setAgentOpen(true)
      try {
        const msgs = await api<ChatMessage[]>(`/projects/${initial.id}/chat`, { body: { text: req.text, intent: req.intent, focus: { stage, ...focus, stepId: activeStep.id, anchor: req.anchor } } })
        setChat((c) => [...c, ...msgs])
      } catch (e) {
        toast((e as Error).message, true)
      } finally {
        setAgentBusy(false)
        setPendingText('')
      }
    },
    [flush, initial.id, stage, activeStep.id, focus, toast, readOnly],
  )

  const act = useCallback(
    async (path: string, body: unknown = {}) => {
      if (readOnly || !(await flush())) return false
      try {
        await api(`/projects/${initial.id}${path}`, { body })
        setProject(await api<Project>(`/projects/${initial.id}`))
        return true
      } catch (e) {
        toast((e as Error).message, true)
        return false
      }
    },
    [flush, initial.id, toast, readOnly],
  )

  const value = useMemo<Studio>(
    () => ({
      project, readOnly, update, flush, reload, stage, setStage, view: route.view, setView, activeStep, setStep, setStepPrompt, focus, setFocus, providers, chat, setChat, agentBusy, pendingText, askAgent, act,
      buildLog, building, setBuilding, preview, previewLog, testsLog, testsRunning, setTestsRunning, toast, agentOpen, setAgentOpen, pipeline, setPipeline,
      buildPart, setBuildPart, section, generating, generate,
    }),
    [project, readOnly, update, flush, reload, stage, route.view, setView, activeStep, setStep, focus, setFocus, providers, chat, agentBusy, pendingText, askAgent, act, buildLog, building, preview, previewLog, testsLog, testsRunning, toast, agentOpen, pipeline, buildPart, section, generating, generate],
  )
  return <MarkdownProjectContext.Provider value={project.id}><StudioContext.Provider value={value}>{children}</StudioContext.Provider></MarkdownProjectContext.Provider>
}
