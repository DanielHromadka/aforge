export type MarkdownAction = 'bold' | 'italic' | 'underline' | 'strike' | 'code' | 'codeblock' | 'bullet' | 'ordered' | 'task' | 'quote' | 'link' | 'image' | 'table' | 'hr' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
export const markdownEdit = (value: string, start: number, end: number, action: MarkdownAction) => {
  const selected = value.slice(start, end)
  const wrapped = { bold: ['**', '**'], italic: ['*', '*'], underline: ['<u>', '</u>'], strike: ['~~', '~~'], code: ['`', '`'], codeblock: ['\n```\n', '\n```\n'], link: ['[', '](https://example.com)'], image: ['![', '](https://example.com/image.png)'] } as const
  let insert = ''
  let cursorStart = 0, cursorEnd = 0
  if (action in wrapped) {
    const [before, after] = wrapped[action as keyof typeof wrapped]
    const body = selected || (action === 'image' ? 'Popis obrázku' : action === 'codeblock' ? 'kód' : 'text')
    insert = before + body + after; cursorStart = before.length; cursorEnd = before.length + body.length
  } else if (action === 'table') {
    insert = '\n\n| Sloupec 1 | Sloupec 2 |\n| --- | --- |\n| Hodnota | Hodnota |\n\n'; cursorStart = cursorEnd = insert.length
  } else if (action === 'hr') {
    insert = '\n\n---\n\n'; cursorStart = cursorEnd = insert.length
  } else {
    const lineStart = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1
    const nextLine = value.indexOf('\n', end)
    const lineEnd = nextLine < 0 ? value.length : nextLine
    const lines = value.slice(lineStart, lineEnd).split('\n')
    insert = lines.map((line, n) => `${action.startsWith('h') ? '#'.repeat(Number(action.slice(1))) + ' ' : action === 'bullet' ? '- ' : action === 'ordered' ? `${n + 1}. ` : action === 'task' ? '- [ ] ' : '> '}${action.startsWith('h') ? line.replace(/^#{1,6}\s+/, '') : line}`).join('\n')
    return { value: value.slice(0, lineStart) + insert + value.slice(lineEnd), start: lineStart, end: lineStart + insert.length }
  }
  return { value: value.slice(0, start) + insert + value.slice(end), start: start + cursorStart, end: start + cursorEnd }
}
