import { describe, expect, it } from 'vitest'
import { newProject, type Story } from '@aforge/shared'
import { patchOf, userPrompts } from './generate.js'

const story: Story = { id: 'US-1', title: 'Kalendář', asA: 'zaměstnanec', iWant: 'vidět směny', soThat: 'vím kdy pracuji', acceptance: [], priority: 'must', status: 'implemented', screenIds: [] }

describe('generate', () => {
  it('puts the generated section first and leaves out empty prompts of other sections', () => {
    const p = { ...newProject('x', 'X', 'Kalendář směn, React + Node'), prompts: { tests: 'Jen chromium', stories: '' } }
    const text = userPrompts(p, 'stories')
    expect(text).toContain('Kalendář směn, React + Node')
    expect(text.indexOf('Stories')).toBeLessThan(text.indexOf('Testy'))
    expect(text).toContain('(prázdný)')
    expect(text).not.toContain('Design')
  })

  it('keeps story statuses, which builds and tests own', () => {
    const p = { ...newProject('x', 'X'), key: 'US', stories: [story] }
    const patch = patchOf(p, 'stories', { epics: [], stories: [{ ...story, status: 'draft', title: 'Kalendář směn' }, { ...story, id: 'US-2', status: 'draft' }], notes: '' })
    expect(patch.stories?.map((s) => [s.id, s.status, s.title])).toEqual([
      ['US-1', 'implemented', 'Kalendář směn'],
      ['US-2', 'draft', 'Kalendář'],
    ])
  })

  it('gives invented or duplicate keys the next free ones and keeps epic links', () => {
    const p = { ...newProject('x', 'Rezervace zasedaček'), stories: [{ ...story, id: 'RZ-2' }] }
    expect(p.key).toBe('RZ')
    const patch = patchOf(p, 'stories', {
      epics: [{ id: 'E1', title: 'Rezervace', description: '', screenIds: [] }],
      stories: [{ ...story, id: 'RZ-2', epicId: 'E1' }, { ...story, id: 'US-9', epicId: 'E1' }, { ...story, id: 'RZ-2', epicId: 'E1' }],
      notes: '',
    })
    expect(patch.epics?.map((e) => e.id)).toEqual(['RZ-3'])
    expect(patch.stories?.map((s) => [s.id, s.epicId])).toEqual([['RZ-2', 'RZ-3'], ['RZ-4', 'RZ-3'], ['RZ-5', 'RZ-3']])
  })

  it('turns a breakdown into proposed tasks of the asked stories and proposes a changed contract', () => {
    const p = { ...newProject('x', 'Rezervace zasedaček'), stories: [{ ...story, id: 'RZ-1' }, { ...story, id: 'RZ-2' }] }
    const patch = patchOf(p, 'split', {
      contract: 'openapi: 3.1.0',
      tasks: [
        { storyId: 'RZ-1', title: 'Mřížka', description: '', layer: 'fe', repoId: 'main' },
        { storyId: 'RZ-1', title: 'API', description: '', layer: 'be', repoId: 'neznamy' },
        { storyId: 'RZ-2', title: 'Mimo výběr', description: '', layer: 'fe', repoId: 'main' },
      ],
      notes: '',
    }, ['RZ-1'])
    expect(patch.issues?.map((i) => [i.id, i.storyId, i.status, i.repoId])).toEqual([['RZ-3', 'RZ-1', 'proposed', 'main'], ['RZ-4', 'RZ-1', 'proposed', 'main']])
    expect(patch.contract).toMatchObject({ yaml: 'openapi: 3.1.0', status: 'proposed', version: 0 })
  })
})
