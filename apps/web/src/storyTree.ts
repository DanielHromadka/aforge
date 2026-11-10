import type { Project, Issue } from '@aforge/shared'

export interface StoryTreeNode { id: string; title: string; kind: 'epic' | 'story' | 'task' | 'bug' | 'subtask' | 'test' | 'folder'; children: StoryTreeNode[] }
/** Legacy orphaned items remain reachable; a bad parent reference must never hide work. */
export const buildStoryTree = (p: Project): StoryTreeNode[] => {
  const used = new Set<string>()
  const issues = p.issues ?? []
  const issueNode = (i: Issue): StoryTreeNode => {
    used.add(i.id)
    return { id: i.id, title: i.title, kind: i.type, children: issues.filter((c) => c.parentId === i.id && !used.has(c.id)).map(issueNode) }
  }
  const storyNode = (s: Project['stories'][number]): StoryTreeNode => {
    const own = issues.filter((i) => i.storyId === s.id && !used.has(i.id))
    const nodes = own.filter((i) => !i.parentId || !issues.some((parent) => parent.id === i.parentId)).map(issueNode)
    for (const i of own) if (!used.has(i.id)) nodes.push(issueNode(i))
    return { id: s.id, title: s.title, kind: 'story', children: [...nodes,
      ...(p.walkthroughs ?? []).filter((w) => w.storyIds[0] === s.id).map((w): StoryTreeNode => ({ id: w.id, title: w.title ?? w.section, kind: 'test', children: [] })),
    ] }
  }
  const tree: StoryTreeNode[] = (p.epics ?? []).map((e) => ({ id: e.id, title: e.title, kind: 'epic', children: p.stories.filter((s) => s.epicId === e.id).map(storyNode) }))
  const loose = p.stories.filter((s) => !p.epics?.some((e) => e.id === s.epicId))
  if (loose.length) tree.push({ id: '__stories', title: 'Bez epicu', kind: 'folder', children: loose.map(storyNode) })
  const orphans: StoryTreeNode[] = []
  for (const i of issues) if (!used.has(i.id)) orphans.push(issueNode(i))
  if (orphans.length) tree.push({ id: '__issues', title: 'Tasky a bugy bez story', kind: 'folder', children: orphans })
  const tests = (p.walkthroughs ?? []).filter((w) => !p.stories.some((s) => s.id === w.storyIds[0]))
  if (tests.length) tree.push({ id: '__tests', title: 'Testy bez story', kind: 'folder', children: tests.map((w) => ({ id: w.id, title: w.title ?? w.section, kind: 'test', children: [] })) })
  return tree
}
