import { describe, expect, it } from 'vitest'
import { parseFigmaUrl } from './figma.js'
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
