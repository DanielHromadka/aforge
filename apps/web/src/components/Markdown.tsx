// Just enough Markdown for agent replies: paragraphs, bullet lists, **bold**, `code`. No HTML passes through.
import type { ReactNode } from 'react'

const inline = (text: string): ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith('`') && part.endsWith('`') ? (
      <code key={i}>{part.slice(1, -1)}</code>
    ) : (
      part
    ),
  )

export const Markdown = ({ text }: { text: string }) => {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flushList = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>)
    list = []
  }
  let table: string[][] = []
  const flushTable = () => {
    if (table.length) {
      const [head, ...rows] = table
      blocks.push(
        <table key={blocks.length}>
          <thead>
            <tr>{head!.map((c, i) => <th key={i}>{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      )
    }
    table = []
  }
  for (const para of text.split(/\n/)) {
    if (/^\s*\|.*\|\s*$/.test(para)) {
      flushList()
      // The |---|---| separator row carries no content.
      if (!/^\s*\|[\s:|-]+\|\s*$/.test(para)) table.push(para.trim().slice(1, -1).split('|').map((c) => c.trim()))
      continue
    }
    flushTable()
    const bullet = para.match(/^\s*(?:[-*•]|\d+\.)\s+(.*)/)
    if (bullet) {
      list.push(bullet[1]!)
      continue
    }
    flushList()
    if (para.trim()) blocks.push(<p key={blocks.length}>{inline(para.replace(/^#+\s*/, ''))}</p>)
  }
  flushList()
  flushTable()
  return <div className="md">{blocks}</div>
}
