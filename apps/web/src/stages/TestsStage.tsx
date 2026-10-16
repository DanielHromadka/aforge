// Tests: the Playwright run against the running container, results mapped to stories, with screenshots.
import { useState } from 'react'
import type { TestCase } from '@aforge/shared'
import { api } from '../api'
import { Icon } from '../icons'
import { useStudio } from '../studio'
import { LogView } from './BuildStage'

const STATUS: Record<TestCase['status'], { label: string; cls: string }> = {
  passed: { label: 'Prošel', cls: 'green' },
  failed: { label: 'Selhal', cls: 'red' },
  timedOut: { label: 'Timeout', cls: 'red' },
  interrupted: { label: 'Přerušen', cls: 'orange' },
  skipped: { label: 'Přeskočen', cls: 'gray' },
}

export const TestsStage = () => {
  const s = useStudio()
  const { project } = s
  const report = project.testReport
  const [selected, setSelected] = useState<number | null>(null)
  const [showLog, setShowLog] = useState(false)
  const current = selected !== null ? report?.cases[selected] : undefined

  const run = async () => {
    try {
      s.setTestsRunning(true)
      setShowLog(true)
      await api(`/projects/${project.id}/tests`, { body: {} })
    } catch (e) {
      s.setTestsRunning(false)
      s.toast((e as Error).message, true)
    }
  }

  const coverage = project.stories.map((st) => {
    const cases = report?.cases.filter((c) => c.storyIds.includes(st.id)) ?? []
    return { st, total: cases.length, passed: cases.filter((c) => c.status === 'passed').length }
  })
  const passed = report?.cases.filter((c) => c.status === 'passed').length ?? 0

  return (
    <>
      <div className="pane-bar">
        <h2>Testy</h2>
        <button className="btn primary" disabled={s.testsRunning || s.preview.state !== 'running'} onClick={() => void run()} title={s.preview.state !== 'running' ? 'Nejdřív spusťte aplikaci v Náhledu' : ''}>
          <Icon.play /> {s.testsRunning ? 'Testy běží…' : 'Spustit testy'}
        </button>
        <button className="btn" disabled={!report || s.agentBusy} onClick={() => void s.askAgent({ intent: 'tests' })}>
          <Icon.sparkles /> Rozebrat výsledky
        </button>
        {report && (
          <span className={`chip ${report.ok ? 'green' : 'red'}`}>
            {passed}/{report.cases.length} prošlo · {new Date(report.finishedAt).toLocaleString('cs')}
          </span>
        )}
        <span className="spacer" />
        <button className={`tool-btn ${showLog ? 'pressed' : ''}`} onClick={() => setShowLog(!showLog)}>
          Log
        </button>
      </div>
      <div className="split">
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="pane-scroll">
            <div className="list-header" style={{ gridTemplateColumns: '1fr 110px 90px 80px' }}>
              <div>Test</div>
              <div>Stories</div>
              <div>Stav</div>
              <div>Čas</div>
            </div>
            <div className="list-body">
              {!report?.cases.length && (
                <div className="empty" style={{ height: 200 }}>
                  <div>
                    Zatím žádné výsledky.
                    <p>Testy generuje agent při buildu do složky e2e/ z akceptačních kritérií; spouští se v kontejneru proti běžící aplikaci.</p>
                  </div>
                </div>
              )}
              {report?.cases.map((c, i) => (
                <div key={i} className={`list-row ${selected === i ? 'selected' : ''}`} style={{ gridTemplateColumns: '1fr 110px 90px 80px' }} onClick={() => setSelected(i)}>
                  <div title={c.title}>{c.title}</div>
                  <div>{c.storyIds.join(', ') || <span className="muted">—</span>}</div>
                  <div>
                    <span className={`chip ${STATUS[c.status].cls}`}>{STATUS[c.status].label}</span>
                  </div>
                  <div className="muted">{(c.durationMs / 1000).toFixed(1)} s</div>
                </div>
              ))}
            </div>
          </div>
          {showLog && (
            <div style={{ height: 220, display: 'flex' }}>
              <LogView lines={s.testsLog.length ? s.testsLog : (report?.log ?? '').split('\n').filter(Boolean).map((text) => ({ kind: 'log', text }))} empty="Log testů je prázdný." />
            </div>
          )}
        </div>
        <div className="inspector">
          {current ? (
            <>
              <h3>Detail testu</h3>
              <div className="group-box">
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{current.title}</div>
                <span className={`chip ${STATUS[current.status].cls}`}>{STATUS[current.status].label}</span>
                {current.error && (
                  <pre className="log" style={{ marginTop: 8, borderRadius: 6, maxHeight: 220, fontSize: 11 }}>
                    {current.error}
                  </pre>
                )}
              </div>
              {current.screenshots.map((p) => (
                <a key={p} href={`/api/projects/${project.id}/raw?path=${encodeURIComponent(p)}`} target="_blank" rel="noreferrer">
                  <img src={`/api/projects/${project.id}/raw?path=${encodeURIComponent(p)}`} alt="Screenshot" style={{ width: '100%', borderRadius: 8, boxShadow: 'var(--shadow-sm)', marginBottom: 8 }} />
                </a>
              ))}
              {current.status !== 'passed' && (
                <button className="btn" onClick={() => void s.askAgent({ text: `Test „${current.title}“ selhal: ${current.error?.slice(0, 1500) ?? ''}\nUrči příčinu (implementace / test / zadání) a navrhni opravu.` })}>
                  <Icon.sparkles /> Proč selhal?
                </button>
              )}
            </>
          ) : (
            <>
              <h3>Pokrytí stories</h3>
              <div className="group-box">
                {coverage.length === 0 && <span className="muted">Zatím žádné stories.</span>}
                {coverage.map(({ st, total, passed: ok }) => (
                  <div key={st.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '3px 0' }}>
                    <span className={`dot ${!total ? '' : ok === total ? 'ok' : 'err'}`} />
                    <span className="chip gray">{st.id}</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{st.title}</span>
                    <span className="muted">{total ? `${ok}/${total}` : 'bez testu'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  )
}
