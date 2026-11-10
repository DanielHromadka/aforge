import { describe, expect, it } from 'vitest'
import { newProject, type DesignElement, type Screen } from '@aforge/shared'
import { mergeSync, parseFigmaUrl } from './figma.js'
import { parseReport } from './tests.js'

describe('parseReport', () => {
  it('maps Playwright JSON to cases with stories and screenshots', () => {
    const cases = parseReport({
      suites: [
        {
          title: 'booking.spec.ts',
          suites: [
            {
              title: 'Rezervace',
              specs: [
                {
                  title: '[US-3] vytvoří rezervaci',
                  tests: [{ results: [{ status: 'failed', duration: 1200, error: { message: '\u001b[31mexpected\u001b[39m' }, attachments: [{ name: 'screenshot', contentType: 'image/png', path: '/workspace/.aforge/test-output/a.png' }] }] }],
                },
              ],
            },
          ],
        },
      ],
    })
    expect(cases).toEqual([
      { title: 'Rezervace › [US-3] vytvoří rezervaci', storyIds: ['US-3'], status: 'failed', durationMs: 1200, error: 'expected', screenshots: ['.aforge/test-output/a.png'] },
    ])
  })
})

describe('parseFigmaUrl', () => {
  it('reads the file key and node id', () => {
    expect(parseFigmaUrl('https://www.figma.com/design/AbC123/App?node-id=12-34&t=x')).toEqual({ fileKey: 'AbC123', nodeId: '12:34' })
    expect(() => parseFigmaUrl('https://example.com')).toThrow()
  })
})

describe('mergeSync', () => {
  const el = (id: string): DesignElement => ({ id, figmaId: id, kind: 'button', type: 'INSTANCE', name: id, x: 0, y: 0, w: 1, h: 1, note: '', storyIds: [], work: false })
  const screen = (id: string, elements: DesignElement[]): Screen => ({ id, figmaId: id, name: id, width: 1, height: 1, elements })

  it('keeps the annotations of layers still in Figma and counts the screens', () => {
    const project = { ...newProject('x', 'X'), screens: [screen('a', [{ ...el('e1'), note: 'n', work: true, storyIds: ['US-1'] }, el('e2')]), screen('gone', [])] }
    const r = mergeSync(project, [screen('a', [{ ...el('e1'), name: 'renamed' }]), screen('new', [el('e3')])])
    expect(r.screens[0]!.elements).toEqual([{ ...el('e1'), name: 'renamed', note: 'n', work: true, storyIds: ['US-1'] }])
    expect([r.added, r.updated, r.removed]).toEqual([1, 1, 1])
  })
})
