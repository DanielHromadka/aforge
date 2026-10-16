// Studio state: the open project (saved with a short debounce), what the user focuses, the agent
// thread and the live logs from the server's event stream.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ChatMessage, PreviewStatus, Project, ProvidersInfo, Stage } from '@aforge/shared'
import { api, useProjectEvents, type HubEvent } from './api'

export interface Focus {
  screenId?: string
  elementId?: string
  storyId?: string
  filePath?: string
  blockId?: string
}

export interface LogLine {
  kind: string
  text: string
}

interface Studio {
  project: Project
  update: (fn: (p: Project) => Project) => void
  flush: () => Promise<void>
  reload: () => Promise<void>
  stage: Stage
  setStage: (s: Stage) => void
  focus: Focus
  setFocus: (f: Focus) => void
  providers?: ProvidersInfo
  chat: ChatMessage[]
  setChat: (c: ChatMessage[]) => void
  agentBusy: boolean
  /** The request in flight, shown in the thread before the agent answers. */
  pendingText: string
  askAgent: (req: { text?: string; intent?: string }) => Promise<void>
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
}

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
  const [stage, setStage] = useState<Stage>(() => (localStorage.getItem(`aforge.stage.${initial.id}`) as Stage) || 'design')
  const [focus, setFocus] = useState<Focus>({ screenId: initial.screens[0]?.id })
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [agentBusy, setAgentBusy] = useState(false)
  const [pendingText, setPendingText] = useState('')
  const [buildLog, setBuildLog] = useState<LogLine[]>([])
  const [building, setBuilding] = useState(false)
  const [preview, setPreview] = useState<PreviewStatus>({ state: 'idle', log: '' })
  const [previewLog, setPreviewLog] = useState('')
  const [testsLog, setTestsLog] = useState<LogLine[]>([])
  const [testsRunning, setTestsRunning] = useState(false)
  const [agentOpen, setAgentOpen] = useState(() => localStorage.getItem('aforge.agentOpen') !== '0')

  const pending = useRef<Project | null>(null)
  const timer = useRef<number>(0)

  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    const next = pending.current
    pending.current = null
    if (next) await api(`/projects/${next.id}`, { method: 'PUT', body: next }).catch((e: Error) => toast(e.message, true))
  }, [toast])

  const update = useCallback(
    (fn: (p: Project) => Project) => {
      setProject((p) => {
        const next = fn(p)
        pending.current = next
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => void flush(), 400)
        return next
      })
    },
    [flush],
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
    void api<ChatMessage[]>(`/projects/${initial.id}/chat`).then(setChat)
    void api<PreviewStatus>(`/projects/${initial.id}/preview`).then((s) => {
      setPreview(s)
      setPreviewLog(s.log)
    })
    void api<{ running: boolean }>(`/projects/${initial.id}/build`).then((b) => setBuilding(b.running))
    return () => void flush()
  }, [initial.id, flush])

  useProjectEvents(initial.id, (e: HubEvent) => {
    if (e.channel === 'project') void reload()
    if (e.channel === 'build') {
      setBuildLog((l) => [...(e.kind === 'start' ? [] : l.slice(-2000)), { kind: e.kind, text: e.text }])
      if (e.kind === 'done' || e.kind === 'error') {
        setBuilding(false)
        toast(e.text, e.kind === 'error')
      }
    }
    if (e.channel === 'preview') {
      if (e.kind === 'log') setPreviewLog((l) => (l + e.text + '\n').slice(-60_000))
      if (e.kind === 'status') setPreview((p) => ({ ...p, ...(e.data as PreviewStatus), log: p.log }))
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
    async (req: { text?: string; intent?: string }) => {
      await flush()
      setAgentBusy(true)
      setPendingText(req.text ?? '')
      setAgentOpen(true)
      try {
        const msgs = await api<ChatMessage[]>(`/projects/${initial.id}/chat`, { body: { ...req, focus: { stage, ...focus } } })
        setChat((c) => [...c, ...msgs])
      } catch (e) {
        toast((e as Error).message, true)
      } finally {
        setAgentBusy(false)
        setPendingText('')
      }
    },
    [flush, initial.id, stage, focus, toast],
  )

  const value = useMemo<Studio>(
    () => ({
      project, update, flush, reload, stage, setStage, focus, setFocus, providers, chat, setChat, agentBusy, pendingText, askAgent,
      buildLog, building, setBuilding, preview, previewLog, testsLog, testsRunning, setTestsRunning, toast, agentOpen, setAgentOpen,
    }),
    [project, update, flush, reload, stage, focus, providers, chat, agentBusy, pendingText, askAgent, buildLog, building, preview, previewLog, testsLog, testsRunning, toast, agentOpen],
  )
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>
}
