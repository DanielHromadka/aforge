// User stories: "As a … I want … so that …" cards with acceptance
// criteria, priority, status and the screens they live on.
import type { Story } from '@aforge/shared'
import { Icon } from '../icons'
import { useStudio } from '../studio'

const PRIORITY: Record<Story['priority'], { label: string; cls: string }> = {
  must: { label: 'Must', cls: 'red' },
  should: { label: 'Should', cls: 'orange' },
  could: { label: 'Could', cls: '' },
  wont: { label: "Won't", cls: 'gray' },
}

const STATUS: Record<Story['status'], { label: string; cls: string }> = {
  draft: { label: 'Koncept', cls: 'gray' },
  ready: { label: 'Připraveno', cls: '' },
  implemented: { label: 'Implementováno', cls: 'purple' },
  verified: { label: 'Ověřeno testy', cls: 'green' },
}

export { PRIORITY as STORY_PRIORITY, STATUS as STORY_STATUS }

const nextId = (stories: Story[]) => `US-${Math.max(0, ...stories.map((s) => Number(s.id.replace(/\D/g, '')) || 0)) + 1}`

export const StoriesStage = () => {
  const s = useStudio()
  const { project } = s
  const selected = project.stories.find((x) => x.id === s.focus.storyId)

  const updateStory = (id: string, patch: Partial<Story>) =>
    s.update((p) => ({ ...p, stories: p.stories.map((x) => (x.id === id ? { ...x, ...patch } : x)) }))

  const add = () => {
    const story: Story = {
      id: nextId(project.stories),
      title: 'Nová story',
      asA: 'uživatel',
      iWant: '',
      soThat: '',
      acceptance: [],
      priority: 'should',
      status: 'draft',
      screenIds: s.focus.screenId ? [s.focus.screenId] : [],
    }
    s.update((p) => ({ ...p, stories: [...p.stories, story] }))
    s.setFocus({ ...s.focus, storyId: story.id })
  }

  const testsFor = (id: string) => project.testReport?.cases.filter((c) => c.storyIds.includes(id)) ?? []

  return (
    <>
      <div className="pane-bar">
        <h2>Zadání</h2>
        <button className="btn primary" onClick={add}>
          <Icon.plus /> Nová story
        </button>
        <button className="btn" disabled={s.generating !== null} onClick={() => void s.generate('stories')} title="Agent vytvoří nebo doplní stories z promptu sekce a designu">
          <Icon.sparkles /> {s.generating === 'stories' ? 'Generuji…' : 'Generovat stories'}
        </button>
        <button className="btn" disabled={s.agentBusy} onClick={() => void s.askAgent({ intent: 'check' })}>
          <Icon.warn /> Zkontrolovat konflikty
        </button>
      </div>
      <div className="split">
        <div className="pane-scroll" style={{ padding: 16, background: 'var(--window)' }}>
          {project.stories.length === 0 && (
            <div className="empty" style={{ height: 'auto', padding: 40 }}>
              <div>
                Zatím žádné user stories.
                <p>Napište požadavky do panelu Prompt sekce a dejte Generovat stories, nebo je přidejte ručně.</p>
              </div>
            </div>
          )}
          {project.stories.map((st) => {
            const tests = testsFor(st.id)
            const failing = tests.filter((t) => t.status !== 'passed' && t.status !== 'skipped').length
            return (
              <div key={st.id} className={`story-card ${st.id === selected?.id ? 'selected' : ''}`} onClick={() => s.setFocus({ ...s.focus, storyId: st.id })}>
                <div className="story-head">
                  <span className="chip gray">{st.id}</span>
                  <strong>{st.title}</strong>
                  <span className={`chip ${PRIORITY[st.priority].cls}`}>{PRIORITY[st.priority].label}</span>
                  <span className={`chip ${STATUS[st.status].cls}`}>{STATUS[st.status].label}</span>
                </div>
                <div className="story-sentence">
                  Jako <b>{st.asA || '…'}</b> chci <b>{st.iWant || '…'}</b>, abych <b>{st.soThat || '…'}</b>.
                </div>
                {st.acceptance.length > 0 && (
                  <ul className="acceptance">
                    {st.acceptance.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  {st.screenIds.map((id) => (
                    <span key={id} className="chip">
                      <Icon.screen /> {project.screens.find((x) => x.id === id)?.name ?? id}
                    </span>
                  ))}
                  {tests.length > 0 && <span className={`chip ${failing ? 'red' : 'green'}`}>{failing ? `${failing}/${tests.length} testů padá` : `${tests.length} testů OK`}</span>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="inspector">
          {selected ? (
            <>
              <h3>Story {selected.id}</h3>
              <div className="group-box">
                <Field label="Název">
                  <input className="field" value={selected.title} onChange={(e) => updateStory(selected.id, { title: e.target.value })} />
                </Field>
                <Field label="Jako">
                  <input className="field" value={selected.asA} onChange={(e) => updateStory(selected.id, { asA: e.target.value })} />
                </Field>
                <Field label="Chci">
                  <textarea className="field" rows={2} value={selected.iWant} onChange={(e) => updateStory(selected.id, { iWant: e.target.value })} />
                </Field>
                <Field label="Abych">
                  <textarea className="field" rows={2} value={selected.soThat} onChange={(e) => updateStory(selected.id, { soThat: e.target.value })} />
                </Field>
                <Field label="Priorita">
                  <select className="field" value={selected.priority} onChange={(e) => updateStory(selected.id, { priority: e.target.value as Story['priority'] })}>
                    {Object.entries(PRIORITY).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Stav">
                  <select className="field" value={selected.status} onChange={(e) => updateStory(selected.id, { status: e.target.value as Story['status'] })}>
                    {Object.entries(STATUS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <h3>Akceptační kritéria (jedno na řádek)</h3>
              <div className="group-box">
                <textarea
                  className="field"
                  rows={6}
                  value={selected.acceptance.join('\n')}
                  placeholder="Given … When … Then …"
                  onChange={(e) => updateStory(selected.id, { acceptance: e.target.value.split('\n') })}
                  onBlur={(e) => updateStory(selected.id, { acceptance: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })}
                />
              </div>
              <h3>Obrazovky</h3>
              <div className="group-box">
                {project.screens.map((sc) => (
                  <label key={sc.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
                    <input
                      type="checkbox"
                      checked={selected.screenIds.includes(sc.id)}
                      onChange={(e) =>
                        updateStory(selected.id, { screenIds: e.target.checked ? [...selected.screenIds, sc.id] : selected.screenIds.filter((x) => x !== sc.id) })
                      }
                    />
                    {sc.name}
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn" onClick={() => void s.askAgent({ text: `Zkontroluj story ${selected.id}: je jednoznačná, testovatelná a v souladu s ostatními stories a designem? Doplň chybějící akceptační kritéria.` })}>
                  <Icon.sparkles /> Zkontrolovat
                </button>
                <button
                  className="btn danger"
                  onClick={() => {
                    s.update((p) => ({ ...p, stories: p.stories.filter((x) => x.id !== selected.id) }))
                    s.setFocus({ ...s.focus, storyId: undefined })
                  }}
                >
                  <Icon.trash />
                </button>
              </div>
            </>
          ) : (
            <div className="muted">Vyberte story pro úpravu.</div>
          )}
        </div>
      </div>
    </>
  )
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="form-row top" style={{ gridTemplateColumns: '58px 1fr' }}>
    <label>{label}</label>
    {children}
  </div>
)
