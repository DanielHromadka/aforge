import { describe, expect, it } from 'vitest'
import { newProject } from '@aforge/shared'
import { adfToMarkdown, jiraBase, mergeJira, parseAcceptance, parseStoryText, wikiToMarkdown, type JiraItem } from './jira.js'

describe('jira text', () => {
  it('turns ADF into Markdown', () => {
    const doc = { type: 'doc', content: [
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] }] },
    ] }
    expect(adfToMarkdown(doc).trim()).toBe('### Acceptance criteria\n\n- one\n- two')
  })

  it('turns wiki markup into Markdown', () => {
    expect(wikiToMarkdown('h2. Title\n* a\n** b\n# c')).toBe('## Title\n- a\n  - b\n1. c')
  })

  it('finds the story sentence in English and Czech', () => {
    expect(parseStoryText('x', 'As a guest, I want to book a table so that I have a seat.')).toEqual({ asA: 'guest', iWant: 'book a table', soThat: 'I have a seat' })
    expect(parseStoryText('Jako host chci rezervovat stůl, abych měl místo', '')).toEqual({ asA: 'host', iWant: 'rezervovat stůl', soThat: 'měl místo' })
    expect(parseStoryText('Login', 'no pattern')).toEqual({ asA: 'uživatel', iWant: 'Login', soThat: '' })
  })

  it('reads acceptance criteria from a field or the description section', () => {
    expect(parseAcceptance('- a\n- b', '')).toEqual(['a', 'b'])
    expect(parseAcceptance(undefined, 'Intro\n\n## Akceptační kritéria\n- given x\n- [ ] then y\n\n## Notes\n- not this')).toEqual(['given x', 'then y'])
  })
})

describe('jiraBase', () => {
  it('requires https and strips browse paths', async () => {
    await expect(jiraBase('http://example.atlassian.net')).rejects.toThrow('https')
    await expect(jiraBase('https://127.0.0.1')).rejects.toThrow('JIRA_HOSTS')
    process.env.JIRA_HOSTS = 'jira.local'
    expect((await jiraBase('http://jira.local/browse/ABC-1?x=1')).href).toBe('http://jira.local/')
    delete process.env.JIRA_HOSTS
  })
})

describe('mergeJira', () => {
  const items: JiraItem[] = [
    { key: 'ABC-2', epic: false, title: 'Story', description: 'As a user, I want X', done: false, epicKey: 'ABC-1', priority: 'High' },
    { key: 'ABC-1', epic: true, title: 'Epic', description: '', done: false },
  ]
  const link = { url: 'https://x.atlassian.net', jql: 'project = ABC' }

  it('adds epics and stories under their Jira keys and links them', () => {
    const { project, added } = mergeJira(newProject('p', 'Projekt'), items, link, 'https://x.atlassian.net/')
    expect(added).toBe(2)
    expect(project.epics?.map((e) => e.id)).toEqual(['ABC-1'])
    expect(project.stories[0]).toMatchObject({ id: 'ABC-2', epicId: 'ABC-1', priority: 'must', asA: 'user', iWant: 'X', status: 'ready' })
    expect(project.stories[0]!.description).toContain('https://x.atlassian.net/browse/ABC-2')
    expect(project.jira?.items).toEqual({ 'ABC-1': 'ABC-1', 'ABC-2': 'ABC-2' })
  })

  it('updates on re-import, keeps local fields and skips deleted items', () => {
    const first = mergeJira(newProject('p', 'Projekt'), items, link, 'https://x.atlassian.net').project
    const edited = { ...first, stories: first.stories.map((s) => ({ ...s, status: 'implemented' as const, screenIds: ['s1'] })) }
    const again = mergeJira(edited, [{ ...items[0]!, title: 'Renamed' }, items[1]!], link, 'https://x.atlassian.net')
    expect(again).toMatchObject({ added: 0, updated: 2 })
    expect(again.project.stories[0]).toMatchObject({ title: 'Renamed', status: 'implemented', screenIds: ['s1'] })
    const deleted = { ...again.project, stories: [], deletedKeys: ['ABC-2'] }
    expect(mergeJira(deleted, items, link, 'https://x.atlassian.net')).toMatchObject({ skipped: 1, updated: 1, added: 0 })
  })

  it('gives a new key when the Jira key is taken', () => {
    const p = { ...newProject('p', 'Projekt'), key: 'ABC', stories: [{ id: 'ABC-2', title: 'local', asA: '', iWant: '', soThat: '', acceptance: [], priority: 'should' as const, status: 'draft' as const, screenIds: [] }] }
    const { project } = mergeJira(p, [items[0]!], link, 'https://x.atlassian.net')
    expect(project.stories.map((s) => s.id)).toEqual(['ABC-2', 'ABC-3'])
    expect(project.jira?.items['ABC-2']).toBe('ABC-3')
  })
})
