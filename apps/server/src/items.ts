import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { deleteItemModel, deletionImpact, itemOf, reposOf, type ItemKind } from '@aforge/shared'
import { mutateProject, projectDir } from './store.js'
import { removeFile } from './workspace.js'
import { publish } from './events.js'
import { isBuilding } from './build.js'
import { isGenerating } from './generate.js'
import { testsRunning } from './tests.js'
import { agentRuns } from './agent-runs.js'
import { scriptSlug } from './walkthrough-lib.js'
import { isPlanningTests } from './walkthrough.js'

export const ItemKindSchema = z.enum(['epic', 'story', 'issue', 'test'])
const title = z.string().trim().min(1).max(1000)
const Edit = {
  epic: z.object({ title, description: z.string().max(100_000) }),
  story: z.object({ title, asA: z.string(), iWant: z.string(), soThat: z.string(), acceptance: z.array(z.string()), epicId: z.string().optional(), priority: z.enum(['must', 'should', 'could', 'wont']) }),
  issue: z.object({ title, description: z.string().max(100_000), layer: z.enum(['fe', 'be', 'api', 'test', 'other']), repoId: z.string() }),
  test: z.object({ title, route: z.string().regex(/^\/\S*$/).max(300), section: z.string().trim().min(1).max(500), instructions: z.string().max(2000) }),
}
const assertIdle = (id: string) => {
  if (isBuilding(id) || isGenerating(id) || testsRunning(id) || isPlanningTests(id) || agentRuns.hasActive(id)) throw new Error('Počkejte, až doběhnou agenti a testy projektu, nebo je nejprve zastavte.')
}
const removeTestFiles = async (projectId: string, w: { script: string; video?: string }) => {
  if (!scriptSlug(w.script)) throw new Error('Neplatná cesta testovacího skriptu.')
  await removeFile(projectId, w.script)
  if (w.video && basename(w.video) === w.video) await rm(join(projectDir(projectId), 'walkthroughs', w.video), { force: true })
}
export const deleteProjectItem = async (projectId: string, kind: ItemKind, id: string, confirmation: unknown) => {
  const saved = await mutateProject(projectId, async (p) => {
    assertIdle(projectId)
    const next = deleteItemModel(p, kind, id, confirmation)
    for (const w of deletionImpact(p, kind, id).tests) {
      if (!(next.walkthroughs ?? []).some((other) => other.script === w.script)) await removeTestFiles(projectId, w)
    }
    return next
  })
  publish(projectId, 'project', 'changed', '')
  return saved
}

export const editProjectItem = async (projectId: string, kind: ItemKind, id: string, raw: unknown) => {
  const saved = await mutateProject(projectId, async (p) => {
    assertIdle(projectId)
    if (!itemOf(p, kind, id)) throw new Error('Položka už neexistuje.')
    const patch = Edit[kind].parse(raw)
    const now = new Date().toISOString()
    if (kind === 'epic') return { ...p, epics: p.epics?.map((e) => e.id === id ? { ...e, ...Edit.epic.parse(patch) } : e) }
    if (kind === 'story') {
      const st = Edit.story.parse(patch)
      if (st.epicId && !p.epics?.some((e) => e.id === st.epicId)) throw new Error('Epic neexistuje.')
      return { ...p, stories: p.stories.map((s) => s.id === id ? { ...s, ...st, epicId: st.epicId || undefined } : s) }
    }
    if (kind === 'issue') {
      const issue = Edit.issue.parse(patch)
      if (!reposOf(p).some((r) => r.id === issue.repoId)) throw new Error('Repozitář neexistuje.')
      return { ...p, issues: p.issues?.map((i) => i.id === id ? { ...i, ...issue, updatedAt: now } : i) }
    }
    const test = Edit.test.parse(patch)
    const w = p.walkthroughs!.find((w) => w.id === id)!
    const changed = test.route !== w.route || test.section !== w.section || test.instructions !== w.instructions || test.title !== w.title
    if (changed) await removeTestFiles(projectId, w)
    return { ...p,
      stories: changed ? p.stories.map((s) => w.storyIds.includes(s.id) && s.status === 'verified' ? { ...s, status: 'implemented' as const } : s) : p.stories,
      walkthroughs: p.walkthroughs!.map((w) => w.id !== id ? w : { ...w, ...test, updatedAt: now, ...(changed ? { status: 'draft' as const, video: undefined, error: undefined, recordedAt: undefined } : {}) }),
    }
  })
  publish(projectId, 'project', 'changed', '')
  return saved
}
