// Tasks and bugs: an agent per repository implements them, in parallel across repositories, and the result
// waits for review. The breakdown of a story is approved as a whole, together with the API contract.
import { reposOf, roleOfIssue, type Issue, type Project } from '@aforge/shared'
import { exclusive, isRepoBusy, renderSpec, renderTask, runAgent } from './build.js'
import { publish } from './events.js'
import { listWorkingSessions, loadProject, mutateProject } from './store.js'
import { changedFiles, commit, ensureRepo, headHash, writeText } from './workspace.js'

const now = () => new Date().toISOString()

/** Changes some issues on top of the latest model; every task state change goes through here. */
const patchIssues = async (projectId: string, fn: (issue: Issue, project: Project) => Issue | null, extra?: (p: Project) => Partial<Project>) => {
  const saved = await mutateProject(projectId, (project) => {
    const issues = (project.issues ?? []).flatMap((i) => { const next = fn(i, project); return next ? [next] : [] })
    return { ...project, issues, ...extra?.({ ...project, issues }) }
  })
  publish(projectId, 'project', 'changed', '')
  return saved
}
const setStatus = (projectId: string, id: string, patch: Partial<Issue>) =>
  patchIssues(projectId, (i) => (i.id === id ? { ...i, ...patch, updatedAt: now() } : i))

/** A story whose tasks are all accepted counts as implemented until its tests say more. */
const storyStatuses = (p: Project): Partial<Project> => ({
  stories: p.stories.map((s) => {
    const own = (p.issues ?? []).filter((i) => i.storyId === s.id && i.type !== 'bug')
    return own.length && own.every((i) => i.status === 'done') && (s.status === 'draft' || s.status === 'ready') ? { ...s, status: 'implemented' } : s
  }),
})

const PROMPT = (issue: Issue) =>
  issue.layer === 'test'
    ? `Napiš automatické testy podle sekce „Tvůj task“ v AFORGE_SPEC.md: ke každému akceptačnímu kritériu story jeden test podle běhového kontraktu (e2e/, klíč story v názvu testu). Implementaci aplikace neměň. Na konci stručně shrň, co testy pokrývají.`
    : `Implementuj ${issue.type === 'bug' ? 'opravu bugu' : 'task'} podle sekce „Tvůj task“ v AFORGE_SPEC.md. Zbytek specifikace je kontext. Dodrž běhový kontrakt, neměň nesouvisející kód a ověř, že se projekt sestaví. Na konci stručně shrň změny.`

/** Runs one task or bug in its repository; resolves when the agent ends. */
export const runIssue = async (projectId: string, issueId: string): Promise<boolean> => {
  const project = await loadProject(projectId)
  const issue = project.issues?.find((i) => i.id === issueId)
  if (!issue) throw new Error('Task nenalezen')
  if (issue.status === 'proposed') throw new Error('Nejdřív schvalte rozpad story.')
  if (issue.layer === 'api') { await writeContract(projectId); return true }
  const repo = reposOf(project).some((r) => r.id === issue.repoId) ? issue.repoId : 'main'
  let reserved = false
  return exclusive(projectId, `V repozitáři ${repo} už pracuje agent.`, async (setKill) => {
    // Reserve against the latest model before any await can overlap a backlog reorganization.
    await mutateProject(projectId, (fresh) => {
      const live = fresh.issues?.find((i) => i.id === issueId)
      if (!live || live.status === 'proposed') throw new Error('Task už není připravený k implementaci. Obnovte rozpad story.')
      return { ...fresh, issues: fresh.issues!.map((i) => i.id === issueId ? { ...i, status: 'running' as const, updatedAt: now() } : i) }
    })
    reserved = true
    await ensureRepo(projectId, repo)
    await writeText(projectId, 'AFORGE_SPEC.md', renderSpec(project, 'incremental') + renderTask(project, issue), repo)
    if (project.contract?.status === 'approved') await writeText(projectId, 'contract/openapi.yaml', project.contract.yaml, repo)
    await commit(projectId, `Reactor: specifikace pro ${issue.id}`, repo)
    const base = await headHash(projectId, repo)
    await setStatus(projectId, issue.id, { status: 'running' })
    const data = { issueId: issue.id }
    publish(projectId, 'build', 'start', `${issue.id} ${issue.title}`, data)
    const ok = await runAgent(projectId, {
      agent: project.stack.agent, prompt: PROMPT(issue), message: `${issue.id} ${issue.title}`, step: `${issue.id} · ${issue.title}`,
      repo, role: roleOfIssue(project, issue), issueId: issue.id, setKill,
      onEvent: (e) => publish(projectId, 'build', e.kind, e.text, data),
    })
    await commit(projectId, `${issue.id} ${issue.title}`, repo)
    const files = await changedFiles(projectId, base, repo)
    await setStatus(projectId, issue.id, { status: ok ? 'review' : 'failed', files, commits: { base, head: await headHash(projectId, repo) } })
    publish(projectId, 'build', ok ? 'done' : 'error', ok ? `${issue.id} čeká na revizi.` : `${issue.id}: agent práci nedokončil.`, data)
    return ok
  }, repo).catch(async (error) => {
    if (reserved) await patchIssues(projectId, (i) => i.id === issueId && i.status === 'running' ? { ...i, status: 'failed', updatedAt: now() } : i)
    throw error
  })
}

export const startIssue = (projectId: string, issueId: string) => {
  void runIssue(projectId, issueId).catch((e: Error) => publish(projectId, 'build', 'error', e.message, { issueId }))
}

/**
 * Implements a whole story: the contract first, then every repository works through its tasks in order while
 * the repositories run side by side.
 */
export const startStory = async (projectId: string, storyId: string) => {
  const project = await loadProject(projectId)
  const open = (project.issues ?? []).filter((i) => i.storyId === storyId && (i.status === 'todo' || i.status === 'failed'))
  if (!open.length) throw new Error('Story nemá žádné tasky k implementaci.')
  const busy = [...new Set(open.map((i) => i.repoId))].filter((r) => isRepoBusy(projectId, r))
  if (busy.length) throw new Error(`V repozitáři ${busy.join(', ')} už pracuje agent.`)
  if (open.some((i) => i.layer === 'api')) await writeContract(projectId)
  // Tests go after the implementation of their repository, so they describe what was built.
  const order = (i: Issue) => (i.layer === 'test' ? 1 : 0)
  const byRepo = new Map<string, Issue[]>()
  for (const i of open.filter((x) => x.layer !== 'api').sort((a, b) => order(a) - order(b))) byRepo.set(i.repoId, [...(byRepo.get(i.repoId) ?? []), i])
  for (const issues of byRepo.values()) {
    void (async () => {
      for (const i of issues) if (!(await runIssue(projectId, i.id).catch(() => false))) break
    })()
  }
}

/** Accepting keeps the commit; the story is implemented once all its tasks are accepted. */
export const acceptIssue = (projectId: string, issueId: string) =>
  patchIssues(projectId, (i) => (i.id === issueId && i.status === 'review' ? { ...i, status: 'done', feedback: undefined, updatedAt: now() } : i), storyStatuses)

/** Returning runs the agent again with the reviewer's comment. */
export const returnIssue = async (projectId: string, issueId: string, feedback: string) => {
  if (!feedback.trim()) throw new Error('Napište, co upravit.')
  await setStatus(projectId, issueId, { status: 'todo', feedback: feedback.trim() })
  startIssue(projectId, issueId)
}

/** Approves the proposed tasks of a story (all stories when none is given) and a proposed contract with them. */
export const approveBreakdown = async (projectId: string, storyId?: string) => {
  const saved = await patchIssues(projectId, (i) => (i.status === 'proposed' && (!storyId || i.storyId === storyId) ? { ...i, status: 'todo', updatedAt: now() } : i))
  if (saved.contract?.status === 'proposed') await writeContract(projectId)
  return loadProject(projectId)
}

export const rejectBreakdown = (projectId: string, storyId: string) =>
  patchIssues(projectId, (i) => (i.status === 'proposed' && i.storyId === storyId ? null : i))

/** Approves the contract and writes it into every repository; its tasks are then done. */
export const writeContract = async (projectId: string) => {
  const project = await loadProject(projectId)
  const contract = project.contract
  if (!contract) return
  const approved = contract.status === 'approved' ? contract : { ...contract, status: 'approved' as const, version: contract.version + 1, updatedAt: now() }
  for (const repo of reposOf(project)) {
    if (repo.platform === 'library') continue
    await ensureRepo(projectId, repo.id)
    await writeText(projectId, 'contract/openapi.yaml', approved.yaml, repo.id)
    await commit(projectId, `Reactor: API kontrakt v${approved.version}`, repo.id)
  }
  await mutateProject(projectId, (p) => ({
    ...p,
    contract: approved,
    issues: p.issues?.map((i) => (i.layer === 'api' && (i.status === 'todo' || i.status === 'failed') ? { ...i, status: 'done', updatedAt: now() } : i)),
  }))
  publish(projectId, 'project', 'changed', '')
}

/** After a restart nothing runs any more: tasks left running are failed and can be started again. */
export const recoverIssues = async () => {
  for (const session of await listWorkingSessions()) {
    const project = await loadProject(session.id).catch(() => null)
    if (!project?.issues?.some((i) => i.status === 'running')) continue
    await mutateProject(session.id, (p) => ({ ...p, issues: p.issues?.map((i) => (i.status === 'running' ? { ...i, status: 'failed', feedback: i.feedback, updatedAt: now() } : i)) }))
  }
}
