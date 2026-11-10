import { describe, expect, it } from 'vitest'
import { newProject, type Walkthrough } from '@aforge/shared'
import { isVideoFile, parseRange, parseWalkthroughReport, scriptSlug, walkthroughPrompt, walkthroughSlug } from './walkthrough-lib.js'

describe('walkthroughSlug', () => {
  it('strips diacritics and keeps slugs unique', () => {
    expect(walkthroughSlug('/rezervace', 'formulář nové rezervace', [])).toBe('rezervace-formular-nove-rezervace')
    expect(walkthroughSlug('/rezervace', 'formulář nové rezervace', ['rezervace-formular-nove-rezervace'])).toBe('rezervace-formular-nove-rezervace-2')
    expect(walkthroughSlug('/', '#__', [])).toBe('pruchod')
  })
})

describe('scriptSlug / isVideoFile', () => {
  it('accepts only our own paths and plain names', () => {
    expect(scriptSlug('e2e/walkthroughs/rezervace-form.spec.ts')).toBe('rezervace-form')
    expect(scriptSlug('e2e/walkthroughs/../x.spec.ts')).toBeNull()
    expect(scriptSlug('e2e/walkthroughs/a b.spec.ts; rm -rf /')).toBeNull()
    expect(isVideoFile('wt-1a2b3c4d.webm')).toBe(true)
    expect(isVideoFile('../project.json')).toBe(false)
    expect(isVideoFile('a.webm/../b.webm')).toBe(false)
  })
})

describe('parseRange', () => {
  it('reads single byte ranges', () => {
    expect(parseRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=10-20', 100)).toEqual({ start: 10, end: 20 })
    expect(parseRange('bytes=-30', 100)).toEqual({ start: 70, end: 99 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=200-', 100)).toBeNull()
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull()
  })
})

describe('parseWalkthroughReport', () => {
  const report = (status: string, extra: object = {}) => ({
    suites: [{ title: 'x.spec.ts', specs: [{ tests: [{ results: [{ status, attachments: [{ name: 'video', contentType: 'video/webm', path: '/workspace/.aforge/walkthrough-output/x/video.webm' }], ...extra }] }] }] }],
  })

  it('finds the video of a passed run', () => {
    expect(parseWalkthroughReport(report('passed'))).toEqual({ ok: true, video: '.aforge/walkthrough-output/x/video.webm', error: undefined })
  })
  it('keeps the video and the error of a failed run', () => {
    expect(parseWalkthroughReport(report('failed', { error: { message: '\u001b[31mTimeout\u001b[39m' } }))).toMatchObject({ ok: false, video: '.aforge/walkthrough-output/x/video.webm', error: 'Timeout' })
  })
  it('reports load errors when there is no test', () => {
    expect(parseWalkthroughReport({ suites: [], errors: [{ message: 'SyntaxError' }] })).toEqual({ ok: false, error: 'SyntaxError' })
  })
  it('ignores video paths outside the workspace', () => {
    const r = report('passed')
    r.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments[0]!.path = '/etc/passwd'
    expect(parseWalkthroughReport(r).video).toBeUndefined()
  })
})

describe('walkthroughPrompt', () => {
  it('names the script, the route, the tag and the linked stories', () => {
    const project = { ...newProject('p', 'P'), stories: [{ id: 'US-3', title: 'Rezervace', asA: 'host', iWant: 'rezervovat', soThat: 'měl stůl', acceptance: [], priority: 'must', status: 'ready', screenIds: [] }] } as unknown as Parameters<typeof walkthroughPrompt>[1]
    const w: Walkthrough = { id: 'wt-1', route: '/rezervace', section: 'formulář', storyIds: ['US-3'], instructions: '', script: 'e2e/walkthroughs/rezervace-formular.spec.ts', status: 'draft', createdAt: '', updatedAt: '' }
    const prompt = walkthroughPrompt(w, project)
    expect(prompt).toContain('e2e/walkthroughs/rezervace-formular.spec.ts')
    expect(prompt).toContain("page.goto('/rezervace')")
    expect(prompt).toContain("'[US-3] Průchod: formulář @walkthrough'")
    expect(prompt).toContain('US-3: Rezervace')
  })
})

describe('test scripts prompt', () => {
  it('asks for every listed file with the story key in the test name and real assertions', async () => {
    const { testScriptsPrompt } = await import('./walkthrough-lib.js')
    const { newProject } = await import('@aforge/shared')
    const project = { ...newProject('x', 'Todo'), stories: [{ id: 'TT-3', title: 'Přidání úkolu', asA: 'uživatel', iWant: 'přidat úkol', soThat: 'ho nezapomenu', acceptance: ['Prázdný název nejde přidat'], priority: 'must' as const, status: 'ready' as const, screenIds: [] }] }
    const base = { route: '/', section: 'formulář', storyIds: ['TT-3'], status: 'draft' as const, createdAt: '', updatedAt: '' }
    const prompt = testScriptsPrompt([
      { ...base, id: 'wt-1', kind: 'test', title: 'Prázdný název nejde přidat', instructions: 'Klikni na Přidat bez názvu, ověř, že tlačítko je vypnuté.', script: 'e2e/walkthroughs/prazdny.spec.ts' },
      { ...base, id: 'wt-2', kind: 'test', title: 'Přidání úkolu', instructions: 'Napiš Koupit mléko, přidej, ověř v seznamu.', script: 'e2e/walkthroughs/pridani.spec.ts' },
    ], project)
    expect(prompt).toContain('e2e/walkthroughs/prazdny.spec.ts')
    expect(prompt).toContain('e2e/walkthroughs/pridani.spec.ts')
    expect(prompt).toContain("'[TT-3] Prázdný název nejde přidat @walkthrough'")
    expect(prompt).toContain('Prázdný název nejde přidat')
    expect(prompt).toContain('import { test, expect }')
  })
})
