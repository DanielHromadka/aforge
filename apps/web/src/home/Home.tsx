// The application around the editor: sign-in, the left menu and the pages of projects, agents, users and settings.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { PROJECT_ROLES, ROLE_LABEL, type HubStatus, type ProjectRole, type ProjectStats, type ProjectSummary, type UserWithProjects } from '@aforge/shared'
import { api } from '../api'
import { signIn, signOut, useAuth } from '../auth'
import { Icon } from '../icons'
import { Logo } from '../components/Logo'
import { Glyph, TypeIcon } from '../components/Glyphs'
import { navigate } from '../router'
import { AgentRuns } from '../components/AgentRuns'
import { ModelRates } from '../components/ModelRates'
import { AddWorkerDialog, useHub, WorkerList } from '../components/Workers'
import { PlanningNotificationsButton } from '../components/PlanningNotifications'

export const LoginPage = () => {
  const error = new URLSearchParams(location.search).get('error')
  return (
    <div className="login">
      <div className="login-card">
        <Logo size={64} />
        <h1>Reactor</h1>
        <button className="btn primary large" onClick={() => signIn(location.pathname === '/' ? '/projects' : location.pathname)}>Přihlásit se</button>
        {error && <p className="login-error" role="alert">{error === 'keycloak' ? 'Keycloak není dostupný.' : 'Přihlášení se nepodařilo.'}</p>}
      </div>
    </div>
  )
}

const MENU = [
  { path: '/projects', label: 'Projekty', icon: 'grid' },
  { path: '/agents', label: 'Agenti', icon: 'sparkles' },
  { path: '/users', label: 'Uživatelé', icon: 'users', admin: true },
  { path: '/settings', label: 'Nastavení', icon: 'gear' },
] as const

export const Home = ({ path, toast }: { path: string; toast: (text: string, error?: boolean) => void }) => {
  const { user } = useAuth()
  const menu = MENU.filter((m) => !('admin' in m) || user.admin)
  const page = menu.find((m) => path.startsWith(m.path))?.path ?? '/projects'
  return (
    <div className="home">
      <nav className="home-nav">
        <div className="home-brand"><Logo size={26} />Reactor</div>
        {menu.map((m) => {
          const I = Icon[m.icon]
          return <button key={m.path} className={`side-link ${page === m.path ? 'current' : ''}`} onClick={() => navigate(m.path)}><I /><span>{m.label}</span></button>
        })}
        <span className="spacer" />
        <PlanningNotificationsButton />
        <div className="home-user">
          <span className="avatar">{initials(user.name)}</span>
          <span className="home-user-name">{user.name}</span>
        </div>
      </nav>
      <main className="home-main">
        {page === '/projects' && <ProjectsPage toast={toast} />}
        {page === '/agents' && <AgentsPage />}
        {page === '/users' && <UsersPage toast={toast} />}
        {page === '/settings' && <SettingsPage toast={toast} />}
      </main>
    </div>
  )
}

const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
const ago = (iso: string) => {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  return min < 1 ? 'právě teď' : min < 60 ? `před ${min} min` : min < 1440 ? `před ${Math.round(min / 60)} h` : new Date(iso).toLocaleDateString('cs-CZ')
}

const PageHead = ({ title, children }: { title: string; children?: ReactNode }) => (
  <header className="page-head"><h1>{title}</h1><span className="spacer" />{children}</header>
)

export const openProject = (id: string) => navigate(`/p/${localStorage.getItem(`aforge.lastSession.${id}`) ?? id}`)

const ProjectsPage = ({ toast }: { toast: (text: string, error?: boolean) => void }) => {
  const [projects, setProjects] = useState<ProjectSummary[]>()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  useEffect(() => { api<ProjectSummary[]>('/projects').then(setProjects, (e: Error) => toast(e.message, true)) }, [toast])
  const shown = projects?.filter((p) => `${p.name} ${p.description}`.toLocaleLowerCase('cs').includes(query.toLocaleLowerCase('cs')))
  return (
    <>
      <PageHead title="Projekty">
        {(projects?.length ?? 0) > 6 && <input className="field page-search" type="search" placeholder="Hledat" value={query} onChange={(e) => setQuery(e.target.value)} />}
        <button className="btn primary" onClick={() => setCreating(true)}><Icon.plus /> Nový projekt</button>
      </PageHead>
      <div className="page-body">
        {projects && !projects.length && <div className="page-empty"><p>Zatím žádný projekt.</p></div>}
        <div className="project-grid">
          {shown?.map((p) => (
            <button key={p.id} className="project-card" onClick={() => openProject(p.id)}>
              <strong>{p.name}</strong>
              {p.description && <span className="project-desc">{p.description}</span>}
              {p.stats && <ProjectStatsRow stats={p.stats} />}
              <span className="project-meta">{ago(p.updatedAt)}{p.role && p.role !== 'owner' ? ` · ${ROLE_LABEL[p.role]}` : ''}</span>
            </button>
          ))}
        </div>
      </div>
      {creating && <NewProject onClose={() => setCreating(false)} />}
    </>
  )
}

const usd = (n: number) => n.toLocaleString('cs-CZ', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 10 ? 2 : 0 })

/** Icons and numbers only, the same vocabulary as in the editor; the words are in the tooltips. */
const ProjectStatsRow = ({ stats }: { stats: ProjectStats }) => (
  <span className="project-stats">
    <span title={`${stats.stories} user stories v ${stats.epics} epicích`}><TypeIcon type="story" size={14} />{stats.stories}</span>
    <span title={`${stats.tasks} tasků, ${stats.bugs} bugů`}><TypeIcon type="task" size={14} />{stats.tasks}{stats.bugs > 0 && <><TypeIcon type="bug" size={14} />{stats.bugs}</>}</span>
    <span title={`${stats.tests.passed} z ${stats.tests.total} testů prošlo`}><Glyph name="test" size={14} />{stats.tests.total ? `${stats.tests.passed}/${stats.tests.total}` : 0}</span>
    <span title={`${stats.agentRuns} běhů agentů`}><Glyph name="team" size={14} />{stats.agentRuns}</span>
    {stats.costUsd > 0 && <span className="project-cost" title="Odhad ceny práce agentů podle sazeb modelů">≈ {usd(stats.costUsd)}</span>}
  </span>
)

const NewProject = ({ onClose }: { onClose: () => void }) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const create = async () => {
    setBusy(true)
    try { navigate(`/p/${(await api<{ id: string }>('/projects', { body: { name, description } })).id}`) }
    catch (e) { setError((e as Error).message); setBusy(false) }
  }
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal onSubmit={(e) => { e.preventDefault(); void create() }}>
        <h3>Nový projekt</h3>
        <div className="stack">
          <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Název" />
          <textarea className="field" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Popis aplikace" />
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Zrušit</button>
          <button className="btn primary" disabled={!name.trim() || busy}>Vytvořit</button>
        </div>
      </form>
    </div>
  )
}

const AgentsPage = () => {
  const { user } = useAuth()
  const { hub, setHub, error, refresh } = useHub()
  const [adding, setAdding] = useState(false)
  return (
    <>
      <PageHead title="Agenti">{user.admin && <button className="btn primary" onClick={() => setAdding(true)}><Icon.plus /> Nový worker</button>}</PageHead>
      <div className="page-body">
        {error && <p role="alert">{error}</p>}
        {hub && <>
          <section className="page-section">
            <h2>Workery</h2>
            <WorkerList hub={hub} admin={user.admin} onChange={setHub} />
          </section>
          <section className="page-section"><AgentRuns runs={hub.runs} /></section>
          {user.admin && <ModelRates hub={hub} onSaved={setHub} />}
        </>}
      </div>
      {adding && <AddWorkerDialog onClose={() => setAdding(false)} onAdded={() => void refresh()} />}
    </>
  )
}

const UsersPage = ({ toast }: { toast: (text: string, error?: boolean) => void }) => {
  const [users, setUsers] = useState<UserWithProjects[]>()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const load = useCallback(() => Promise.all([api<UserWithProjects[]>('/users'), api<ProjectSummary[]>('/projects')]).then(([u, p]) => { setUsers(u); setProjects(p) }, (e: Error) => toast(e.message, true)), [toast])
  useEffect(() => { void load() }, [load])
  const setRole = async (projectId: string, userId: string, role: ProjectRole | null) => {
    try { await api(`/projects/${projectId}/members/${userId}`, { method: 'PUT', body: { role } }); await load() }
    catch (e) { toast((e as Error).message, true) }
  }
  const name = (id: string) => projects.find((p) => p.id === id)?.name ?? id
  return (
    <>
      <PageHead title="Uživatelé" />
      <div className="page-body">
        <div className="plain-list">
          {users?.map((u) => {
            const own = Object.entries(u.projects)
            const free = projects.filter((p) => !u.projects[p.id])
            return (
              <div key={u.id} className={`user-item ${open === u.id ? 'open' : ''}`}>
                <button className="plain-row" onClick={() => setOpen(open === u.id ? null : u.id)}>
                  <span className="avatar">{initials(u.name)}</span>
                  <div className="plain-main"><strong>{u.name}</strong><span className="muted">{u.email ?? u.username}</span></div>
                  <span className="muted">{u.admin ? 'Administrátor' : own.length ? `${own.length} ${own.length === 1 ? 'projekt' : own.length < 5 ? 'projekty' : 'projektů'}` : ''}</span>
                </button>
                {open === u.id && (
                  <div className="user-projects">
                    {own.map(([pid, role]) => (
                      <div key={pid} className="user-project">
                        <span>{name(pid)}</span>
                        <select className="field" value={role} onChange={(e) => void setRole(pid, u.id, e.target.value as ProjectRole)}>
                          {PROJECT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                        </select>
                        <button className="tool-btn" title="Odebrat z projektu" onClick={() => void setRole(pid, u.id, null)}><Icon.x /></button>
                      </div>
                    ))}
                    {!!free.length && (
                      <select className="field user-add" value="" onChange={(e) => e.target.value && void setRole(e.target.value, u.id, 'editor')}>
                        <option value="">Přidat do projektu…</option>
                        {free.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

const SettingsPage = ({ toast }: { toast: (text: string, error?: boolean) => void }) => {
  const auth = useAuth()
  const { hub, setHub } = useHub()
  const [relay, setRelay] = useState<string>()
  const configure = (body: { relay?: string; mode?: 'local' | 'remote' }) => api<HubStatus>('/hub', { method: 'PUT', body }).then(setHub, (e: Error) => toast(e.message, true))
  return (
    <>
      <PageHead title="Nastavení" />
      <div className="page-body settings">
        <section className="page-section">
          <h2>Účet</h2>
          <dl className="settings-list">
            <div><dt>Jméno</dt><dd>{auth.user.name}</dd></div>
            <div><dt>Uživatel</dt><dd>{auth.user.email ?? auth.user.username}</dd></div>
            <div><dt>Role</dt><dd>{auth.user.admin ? 'Administrátor' : 'Uživatel'}</dd></div>
            {auth.issuer && <div><dt>Keycloak</dt><dd className="mono">{auth.issuer}</dd></div>}
          </dl>
          {auth.enabled && <button className="btn" onClick={() => void signOut()}><Icon.logout /> Odhlásit</button>}
        </section>
        {auth.user.admin && hub && (
          <section className="page-section">
            <h2>Spouštění agentů</h2>
            <dl className="settings-list">
              <div>
                <dt>Kde</dt>
                <dd>
                  <div className="segmented">
                    <button className={hub.mode === 'local' ? 'active' : ''} onClick={() => void configure({ mode: 'local' })}>Lokálně</button>
                    <button className={hub.mode === 'remote' ? 'active' : ''} onClick={() => void configure({ mode: 'remote' })}>Workery</button>
                  </div>
                </dd>
              </div>
              <div>
                <dt>Relay</dt>
                <dd className="settings-inline">
                  <input className="field mono" value={relay ?? hub.relay} onChange={(e) => setRelay(e.target.value)} placeholder="wss://relay.example.com" />
                  <button className="btn" disabled={relay === undefined || relay === hub.relay} onClick={() => void configure({ relay })}>Uložit</button>
                  <span className={`dot ${hub.connected ? 'ok' : hub.error ? 'err' : ''}`} title={hub.connected ? 'Připojeno' : hub.error ?? 'Nepřipojeno'} />
                </dd>
              </div>
            </dl>
          </section>
        )}
      </div>
    </>
  )
}
