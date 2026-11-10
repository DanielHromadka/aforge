import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from './components/Markdown'
import { markdownEdit } from './markdownEdit'

describe('Markdown descriptions', () => {
  it('renders GFM, underline and safe HTML, while removing executable content and unsafe URLs', () => {
    const html = renderToStaticMarkup(<Markdown projectId="demo" text={'# Nadpis\n\n**Tučně** a *kurzíva* <u>podtrženo</u>\n\n- [x] Hotovo\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">odkaz</a><iframe src="https://evil.test"></iframe>'} />)
    expect(html).toContain('<h1>Nadpis</h1>')
    expect(html).toContain('<u>podtrženo</u>')
    expect(html).toContain('<strong>Tučně</strong>')
    expect(html).toContain('<table>')
    expect(html).not.toMatch(/<script|onerror|javascript:|<iframe/)
  })
  it('resolves image attachment links for the current session and snapshots', () => {
    const id = '12345678-1234-1234-1234-123456789abc'
    const html = renderToStaticMarkup(<Markdown projectId="demo--initial--123456abcdef" text={`![Náhled](attachment:${id})`} />)
    expect(html).toContain(`/api/projects/demo--initial--123456abcdef/attachments/${id}`)
    expect(html).toContain('alt="Náhled"')
  })
  it('formats selected text and complete lines while preserving the rest of the source', () => {
    expect(markdownEdit('ahoj svět', 5, 9, 'bold').value).toBe('ahoj **svět**')
    expect(markdownEdit('ahoj', 0, 4, 'underline').value).toBe('<u>ahoj</u>')
    expect(markdownEdit('## Nadpis', 0, 9, 'h3').value).toBe('### Nadpis')
    expect(markdownEdit('a\nb', 0, 3, 'ordered').value).toBe('1. a\n2. b')
    expect(markdownEdit('\na', 0, 0, 'h1').value).toBe('# \na')
  })
})
