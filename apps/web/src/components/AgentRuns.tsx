import { useState } from 'react'
import type { AgentRun } from '@aforge/shared'

const STATE: Record<AgentRun['state'], string> = { queued: 'Čeká na workera', running: 'Běží', done: 'Hotovo', failed: 'Chyba', cancelled: 'Zrušeno', interrupted: 'Přerušeno' }
const number = (n: number) => n.toLocaleString('cs-CZ')
export const isLive = (run: AgentRun) => run.state === 'running' || run.state === 'queued'
export const duration = (run: AgentRun) => {
  const seconds = Math.max(0, Math.floor((new Date(run.finishedAt ?? Date.now()).getTime() - new Date(run.startedAt).getTime()) / 1000))
  return seconds < 60 ? `${seconds} s` : seconds < 3600 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${Math.floor(seconds / 3600)} h ${Math.floor(seconds % 3600 / 60)} min`
}

/** Without a project it is the global overview. */
export const AgentRuns = ({ runs, projectId }: { runs: AgentRun[]; projectId?: string }) => {
  const [scope, setScope] = useState('all')
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const visible = runs.filter((r) => (scope !== 'project' || (r.projectId === projectId || r.rootProjectId === projectId)) && (status !== 'live' || isLive(r)) && `${r.projectName} ${r.sessionName ?? ''} ${r.step} ${r.host} ${r.agent} ${r.usage.model ?? ''}`.toLocaleLowerCase('cs').includes(search.toLocaleLowerCase('cs')))
  const live = runs.filter(isLive).length
  return (
    <section className="agent-runs" aria-labelledby="agent-runs-title">
      <div className="agent-runs-heading">
        <h3 className="section-title" id="agent-runs-title">Běhy agentů <span className="muted">{live} aktivních</span></h3>
        <div className="agent-run-filters">
          <input type="search" className="field" aria-label="Hledat běh agenta" placeholder="Projekt, krok, agent…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {projectId && <select className="field" aria-label="Projekty v přehledu" value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">Všechny projekty</option><option value="project">Tento projekt</option></select>}
          <select className="field" aria-label="Stavy běhů" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Všechny běhy</option><option value="live">Aktivní běhy</option></select>
        </div>
      </div>
      <div className="agent-runs-table-wrap">
        <table className="agent-runs-table">
          <thead><tr><th>Agent / model</th><th>Kde</th><th>Projekt / krok</th><th>Stav / od kdy</th><th>Kontext</th><th>Tokeny celkem</th><th>Cena (USD)</th></tr></thead>
          <tbody>
            {visible.map((r) => {
              const u = r.usage
              const percent = u.contextTokens !== undefined && u.contextWindow ? Math.round(u.contextTokens / u.contextWindow * 100) : undefined
              return <tr key={r.id}>
                <td><strong>{r.agent === 'claude' ? 'Claude Code' : r.agent === 'codex' ? 'Codex' : 'Anthropic API'}</strong><small>{u.model ?? (isLive(r) ? 'Model zatím nehlášen' : 'Model nehlášen')}</small></td>
                <td>{r.location === 'local' ? 'Lokálně' : 'Worker'}<small>{r.host}</small></td>
                <td><strong>{r.projectName}</strong>{r.sessionName && <small>{r.sessionName}</small>}<small>{r.step}</small>{r.activity && <details><summary>Poslední činnost</summary><span className="mono">{r.activity}</span></details>}</td>
                <td><span className={`chip ${r.state === 'failed' ? 'red' : r.state === 'done' ? 'green' : 'gray'}`}>{isLive(r) && <span className={`dot ${r.state === 'running' ? 'run' : ''}`} />}{STATE[r.state]}</span><small><time dateTime={r.startedAt}>{new Date(r.startedAt).toLocaleString('cs-CZ')}</time></small><small>{duration(r)}</small>{r.error && <details><summary>Podrobnosti</summary>{r.error}</details>}</td>
                <td className="agent-context">
                  {u.contextTokens !== undefined ? <>{number(u.contextTokens)}{u.contextWindow ? ` / ${number(u.contextWindow)}` : ''}</> : 'Nedostupné'}
                  {percent !== undefined ? <><progress value={Math.min(percent, 100)} max={100} aria-label={`Zaplnění kontextu ${percent} %`} /><small>{percent} % kontextového okna</small></> : <small>{u.contextWindow ? `Okno ${number(u.contextWindow)}` : 'Velikost okna nehlášena'}</small>}
                </td>
                <td>{u.inputTokens !== undefined && u.outputTokens !== undefined ? <>{number(u.inputTokens + u.outputTokens)}<small>{number(u.inputTokens)} vstup · {number(u.outputTokens)} výstup</small>{u.cachedInputTokens !== undefined && <small>{number(u.cachedInputTokens)} z cache</small>}</> : <span className="muted">{isLive(r) ? 'Čeká na údaje' : 'Nehlášeno'}</span>}</td>
                <td>{u.costUsd !== undefined ? <>{u.costUsd.toLocaleString('cs-CZ', { style: 'currency', currency: 'USD', minimumFractionDigits: 4 })}<small>{u.costSource === 'provider' ? 'Hlášeno CLI' : 'Odhad ze sazeb'}</small></> : <><span className="muted">Nedostupná</span><small>{u.model ? 'Cena ani sazba nehlášena' : isLive(r) ? 'Čeká na model a sazbu' : 'Model ani sazba nehlášeny'}</small></>}</td>
              </tr>
            })}
            {!visible.length && <tr><td colSpan={7} className="agent-runs-empty">{runs.length ? 'Zvoleným filtrům neodpovídá žádný běh.' : 'Zatím žádné běhy.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="agent-usage-note muted">Cena je orientační, u předplatného nejde o účtovanou částku.</p>
    </section>
  )
}
