// Build: choose the stack and the agent, look at the generated spec, and run Claude Code or Codex in
// the project's workspace with its output streamed live.
import { useEffect, useRef, useState } from 'react'
import type { StackConfig } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { useStudio } from '../studio'
import { Markdown } from '../components/Markdown'

const OPTIONS: { key: keyof StackConfig; label: string; values: [string, string][] }[] = [
  { key: 'agent', label: 'Agent', values: [['claude', 'Claude Code'], ['codex', 'OpenAI Codex']] },
  { key: 'backend', label: 'Backend', values: [['dotnet', '.NET 8 (ASP.NET Core)'], ['node', 'Node.js + Fastify'], ['python', 'Python + FastAPI']] },
  { key: 'frontend', label: 'Frontend', values: [['react', 'React + Vite'], ['vue', 'Vue 3 + Vite']] },
  {
    key: 'hosting',
    label: 'Hosting',
    values: [
      ['azure-container-apps', 'Azure Container Apps'],
      ['aks', 'Azure Kubernetes Service'],
      ['app-service', 'Azure App Service'],
      ['azure-static-web-apps', 'Azure Static Web Apps + API'],
    ],
  },
]

export const LogView = ({ lines, empty }: { lines: { kind: string; text: string }[]; empty: string }) => {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight
  }, [lines.length])
  return (
    <pre className="log" ref={ref} style={{ flex: 1, minHeight: 0 }}>
      {lines.length === 0 && <span style={{ opacity: 0.5 }}>{empty}</span>}
      {lines.map((l, i) => (
        <div key={i} className={`l-${l.kind === 'error' ? 'err' : l.kind}`}>
          {l.kind === 'tool' ? '▸ ' : l.kind === 'text' ? '◆ ' : ''}
          {l.text}
        </div>
      ))}
    </pre>
  )
}

export const BuildStage = () => {
  const s = useStudio()
  const { project, providers } = s
  const [spec, setSpec] = useState<string | null>(null)

  const start = async (mode: 'full' | 'incremental') => {
    await s.flush()
    try {
      s.setBuilding(true)
      await api(`/projects/${project.id}/build`, { body: { mode } })
    } catch (e) {
      s.setBuilding(false)
      s.toast((e as Error).message, true)
    }
  }

  const agentAvailable = project.stack.agent === 'codex' ? providers?.codex : providers?.claude
  const openAnnotations = project.annotations.filter((a) => a.status === 'open').length
  const failing = project.testReport?.cases.filter((c) => c.status !== 'passed' && c.status !== 'skipped').length ?? 0
  const checks: [boolean, string][] = [
    [project.stories.length > 0, `${project.stories.length} user stories`],
    [project.stories.every((x) => x.acceptance.length > 0), 'Každá story má akceptační kritéria'],
    [project.screens.some((x) => x.elements.length > 0), 'Alespoň jedna obrazovka s wireframem'],
    [project.blocks.nodes.length > 0, `${project.blocks.nodes.length} bloků v modelu`],
    [Boolean(agentAvailable), `${project.stack.agent === 'codex' ? 'Codex' : 'Claude Code'} je nainstalovaný`],
  ]

  return (
    <>
      <div className="pane-bar">
        <h2>Build</h2>
        {s.building ? (
          <button className="btn" onClick={() => void api(`/projects/${project.id}/build/stop`, { body: {} })}>
            <Icon.stop /> Zastavit
          </button>
        ) : (
          <>
            <button className="btn primary" disabled={!agentAvailable || !project.stories.length} onClick={() => void start('full')}>
              <Icon.play /> Kompletní implementace
            </button>
            <button className="btn" disabled={!agentAvailable} onClick={() => void start('incremental')} title="Zapracuje nové stories, otevřené anotace a padající testy">
              Inkrementální změny{openAnnotations + failing ? ` (${openAnnotations} anotací, ${failing} testů)` : ''}
            </button>
          </>
        )}
        <span className="spacer" />
        <button
          className="tool-btn"
          onClick={async () => {
            await s.flush()
            setSpec(spec === null ? (await api<{ spec: string }>(`/projects/${project.id}/spec`)).spec : null)
          }}
        >
          <Icon.stories /> {spec === null ? 'Zobrazit specifikaci' : 'Zobrazit průběh'}
        </button>
      </div>
      <div className="split left" style={{ gridTemplateColumns: '300px 1fr' }}>
        <div className="inspector">
          <h3>Stack a agent</h3>
          <div className="group-box">
            {OPTIONS.map((o) => (
              <div key={o.key} className="form-row" style={{ gridTemplateColumns: '64px 1fr' }}>
                <label>{o.label}</label>
                <select className="field" value={project.stack[o.key]} disabled={s.building} onChange={(e) => s.update((p) => ({ ...p, stack: { ...p.stack, [o.key]: e.target.value } }))}>
                  {o.values.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <h3>Připravenost</h3>
          <div className="group-box">
            {checks.map(([ok, label]) => (
              <div key={label} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
                <span className={`dot ${ok ? 'ok' : 'warn'}`} /> {label}
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 11.5 }}>
            aForge zapíše <code>AFORGE_SPEC.md</code> do pracovního repozitáře projektu a spustí agenta v neinteraktivním režimu. Claude Code smí upravovat soubory a spouštět jen npm, dotnet, git a podobné
            nástroje; Codex běží v sandboxu <code>workspace-write</code>. Výsledek se commitne.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {spec !== null ? (
            <div className="pane-scroll" style={{ padding: '16px 24px' }}>
              <Markdown text={spec} />
            </div>
          ) : (
            <LogView lines={s.buildLog} empty="Zde se zobrazí průběh práce agenta." />
          )}
        </div>
      </div>
    </>
  )
}
