// The breakdown: the Architect splits stories into tasks for the project's repositories and keeps the API
// contract that joins them. The user approves a story's breakdown as a whole. The architecture diagrams and
// the implementation prompt live in the second tab.
import { useState } from 'react'
import { PLATFORMS, PLATFORM_LABEL, reposOf, type Platform, type Repo } from '@aforge/shared'
import { ActionButton } from '../components/ActionButton'
import { useStudio } from '../studio'
import { BuildStage } from './BuildStage'
import { Glyph, PLATFORM_UI, StatusIcon, Tile, TypeIcon } from '../components/Glyphs'
import { IssueFilterBar, IssueGroup, IssueRow, issuesOf, isFiltered, matchesFilter, NO_FILTER, useCollapsed, type IssueFilter } from '../components/Work'
import { Markdown } from '../components/Markdown'
import { Icon } from '../icons'

export const SplitStage = () => {
  const [tab, setTab] = useState<'split' | 'arch'>('split')
  const tabs = (
    <div className="segmented">
      <button className={tab === 'split' ? 'active' : ''} onClick={() => setTab('split')}>Rozpad</button>
      <button className={tab === 'arch' ? 'active' : ''} onClick={() => setTab('arch')}>Architektura</button>
    </div>
  )
  return tab === 'arch' ? <><div className="pane-bar"><h2>Rozpad</h2>{tabs}</div><BuildStage /></> : <Breakdown tabs={tabs} />
}

const Breakdown = ({ tabs }: { tabs: React.ReactNode }) => {
  const s = useStudio()
  const p = s.project
  const pending = p.stories.filter((x) => issuesOf(p, x.id).some((i) => i.status === 'proposed'))
  const [filter, setFilter] = useState<IssueFilter>(NO_FILTER)
  const groups = useCollapsed()
  const all = (p.issues ?? []).filter((i) => i.type !== 'bug')
  const without = p.stories.filter((x) => !issuesOf(p, x.id).some((i) => i.type !== 'bug'))
  return (
    <>
      <div className="pane-bar">
        <h2>Rozpad</h2>
        {tabs}
        <span className="spacer" />
        {!s.readOnly && <>
          {pending.length > 0 && <ActionButton busyLabel="Schvaluji…" icon={<Glyph name="check" />} onClick={() => s.act('/breakdown/approve')}>Schválit vše</ActionButton>}
          <ActionButton className="btn primary" disabled={s.generating !== null || !without.length} busy={s.generating === 'split'} busyLabel="Architekt pracuje…" icon={<Glyph name="split" />}
            title={without.length ? `Stories bez tasků: ${without.map((x) => x.id).join(', ')}` : 'Všechny stories mají tasky'} onClick={() => s.generate('split')}>
            {`Rozpadnout${without.length ? ` ${without.length}` : ''}`}
          </ActionButton>
        </>}
      </div>
      <div className="pane-scroll split-view">
        <div className="split-side">
          <Repos />
          <Contract />
        </div>
        <div className="split-main">
          {!p.stories.length && <div className="muted empty-line">Nejdřív vytvořte stories.</div>}
          {all.length > 5 && <IssueFilterBar filter={filter} onChange={setFilter} issues={all} />}
          {p.stories.map((story) => {
            const tasks = issuesOf(p, story.id).filter((i) => i.type !== 'bug')
            const shown = tasks.filter((i) => matchesFilter(i, filter))
            if (isFiltered(filter) && !shown.length && !`${story.id} ${story.title}`.toLocaleLowerCase('cs').includes(filter.q.trim().toLocaleLowerCase('cs'))) return null
            const proposed = tasks.some((i) => i.status === 'proposed')
            const open = groups.isOpen(`split:${story.id}`, proposed || tasks.length <= 4 || isFiltered(filter))
            return (
              <section key={story.id} className="card-pane split-story">
                <IssueGroup issues={shown} open={open} onToggle={(o) => groups.toggle(`split:${story.id}`, o)}
                  title={<><TypeIcon type="story" /><span className="key">{story.id}</span><span className="ell">{story.title}</span>{proposed && <StatusIcon shape="wait" label="Rozpad ke schválení" />}</>}
                  actions={!s.readOnly && <>
                    {proposed && <ActionButton className="btn small primary" onClick={() => s.act(`/stories/${story.id}/breakdown/approve`)}>Schválit</ActionButton>}
                    {proposed && <ActionButton className="btn small" onClick={() => s.act(`/stories/${story.id}/breakdown/reject`)}>Zamítnout</ActionButton>}
                    <button className="tool-btn" title="Otevřít story" onClick={() => { s.setFocus({ ...s.focus, storyId: story.id }); s.setStage('stories') }}><TypeIcon type="story" size={14} /></button>
                    <ActionButton className="tool-btn" title={tasks.length ? 'Rozpadnout znovu' : 'Rozpadnout'} disabled={s.generating !== null} onClick={() => s.generate('split', [story.id])}><Glyph name="split" /></ActionButton>
                  </>}>
                  {shown.length ? shown.map((i) => <IssueRow key={i.id} issue={i} />) : <div className="muted small">{tasks.length ? 'Filtru neodpovídá žádný task' : 'Bez tasků'}</div>}
                </IssueGroup>
              </section>
            )
          })}
        </div>
      </div>
    </>
  )
}

const Repos = () => {
  const s = useStudio()
  const repos = reposOf(s.project)
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<Platform>('backend')
  const slug = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  const save = (next: Repo[]) => s.update((p) => ({ ...p, repos: next }))
  return (
    <section className="card-pane">
      <h3>Repozitáře</h3>
      {repos.map((r) => (
        <div key={r.id} className="repo-row">
          <Tile glyph={PLATFORM_UI[r.platform]} tone={r.platform === 'backend' ? 'var(--c-be)' : r.platform === 'library' ? 'var(--c-split)' : 'var(--c-fe)'} size={24} />
          <div className="grow">
            <input className="plain-input" value={r.name} readOnly={s.readOnly} aria-label="Název repozitáře" onChange={(e) => save(repos.map((x) => (x.id === r.id ? { ...x, name: e.target.value } : x)))} />
            <select className="plain-select muted small" disabled={s.readOnly} value={r.platform} onChange={(e) => save(repos.map((x) => (x.id === r.id ? { ...x, platform: e.target.value as Platform } : x)))}>
              {PLATFORMS.map((pl) => <option key={pl} value={pl}>{PLATFORM_LABEL[pl]}</option>)}
            </select>
          </div>
          {r.id === 'main' ? <span className="muted small">hlavní</span> : !s.readOnly && <button className="tool-btn" title="Odebrat" onClick={() => save(repos.filter((x) => x.id !== r.id))}><Icon.trash /></button>}
        </div>
      ))}
      {!s.readOnly && (
        <form className="row-gap" onSubmit={(e) => { e.preventDefault(); if (slug && !repos.some((r) => r.id === slug)) { save([...repos, { id: slug, name: name.trim(), platform }]); setName('') } }}>
          <input className="field" placeholder="Nový repozitář" value={name} onChange={(e) => setName(e.target.value)} />
          <select className="field" style={{ width: 'auto' }} value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>{PLATFORMS.map((pl) => <option key={pl} value={pl}>{PLATFORM_LABEL[pl]}</option>)}</select>
          <button className="btn" disabled={!slug || repos.some((r) => r.id === slug)}>Přidat</button>
        </form>
      )}
    </section>
  )
}

const Contract = () => {
  const s = useStudio()
  const c = s.project.contract
  return (
    <section className="card-pane">
      <h3><Tile glyph="api" tone="var(--c-split)" size={20} /> API kontrakt</h3>
      {!c ? <div className="muted small">Vznikne při rozpadu, když klient komunikuje s backendem.</div> : <>
        <div className="row-gap">
          <StatusIcon shape={c.status === 'approved' ? 'ok' : 'wait'} />
          <span>{c.status === 'approved' ? `Verze ${c.version}, v každém repozitáři jako contract/openapi.yaml` : 'Změna ke schválení'}</span>
          {c.status === 'proposed' && !s.readOnly && <ActionButton className="btn small primary" busyLabel="Zapisuji…" onClick={() => s.act('/contract/approve')}>Schválit</ActionButton>}
        </div>
        <details className="contract-yaml"><summary>openapi.yaml</summary><Markdown text={'```yaml\n' + c.yaml + '\n```'} /></details>
      </>}
    </section>
  )
}
