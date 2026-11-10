import { useRef, useState } from 'react'
import { attachmentRef, attachmentsFor, descriptionKey, descriptionOf, descriptionVersion, type DescriptionKind, type ProjectAttachment } from '@aforge/shared'
import { useStudio } from '../studio'
import { markdownEdit, type MarkdownAction } from '../markdownEdit'
import { Markdown } from './Markdown'
import { ActionButton } from './ActionButton'
import { Glyph } from './Glyphs'
import { Dialog } from './Dialog'

const TOOLS: { action: MarkdownAction; label: string; text: string }[] = [
  { action: 'bold', label: 'Tučně', text: 'B' }, { action: 'italic', label: 'Kurzíva', text: 'I' }, { action: 'underline', label: 'Podtržení', text: 'U' }, { action: 'strike', label: 'Přeškrtnutí', text: 'S' },
  { action: 'bullet', label: 'Odrážky', text: '•' }, { action: 'ordered', label: 'Číslovaný seznam', text: '1.' }, { action: 'task', label: 'Seznam úkolů', text: '☑' },
  { action: 'quote', label: 'Citace', text: '❞' }, { action: 'code', label: 'Řádkový kód', text: '<>' }, { action: 'codeblock', label: 'Blok kódu', text: '{ }' },
  { action: 'link', label: 'Odkaz', text: 'Odkaz' }, { action: 'image', label: 'Obrázek z odkazu', text: 'Obrázek' }, { action: 'table', label: 'Tabulka', text: 'Tabulka' }, { action: 'hr', label: 'Vodorovná čára', text: '―' },
]
const fileSize = (n: number) => n < 1024 * 1024 ? `${Math.ceil(n / 1024)} kB` : `${(n / 1024 / 1024).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} MB`

export const DescriptionEditor = ({ kind, id, readOnly = false }: { kind: DescriptionKind; id: string; readOnly?: boolean }) => {
  const s = useStudio()
  const current = descriptionOf(s.project, kind, id)
  const version = descriptionVersion(s.project, kind, id)
  const history = s.project.descriptionHistory?.[descriptionKey(kind, id)] ?? []
  const [editing, setEditing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selectedVersion, setSelectedVersion] = useState<number>()
  const [source, setSource] = useState(false)
  const revision = history.find((h) => h.version === selectedVersion) ?? history[history.length - 1]
  const locked = readOnly || s.readOnly
  return <section className="description-document">
    <div className="row-gap description-head"><h3 className="grow">Popis</h3>{history.length > 0 && <button className="btn small" onClick={() => { setHistoryOpen(!historyOpen); setEditing(false) }}><Glyph name="history" /> Historie ({history.length})</button>}{!locked && !editing && <button className="btn small" onClick={() => { setEditing(true); setHistoryOpen(false) }}><Glyph name="pencil" /> Editovat</button>}</div>
    {editing ? <MarkdownSourceEditor key={`${kind}:${id}`} kind={kind} id={id} initial={current} version={version} onClose={() => setEditing(false)} /> : historyOpen && revision ? <div className="description-history">
      <div className="row-gap"><label className="review-field grow">Verze<select className="field" value={revision.version} onChange={(e) => setSelectedVersion(Number(e.target.value))}>{[...history].reverse().map((r) => <option key={r.version} value={r.version}>v{r.version} · {new Date(r.createdAt).toLocaleString('cs-CZ')} · {r.author}</option>)}</select></label><button className="btn small" onClick={() => setSource(!source)}>{source ? 'Náhled' : 'Zdroj Markdownu'}</button></div>
      {source ? <pre className="description-source-preview">{revision.text}</pre> : <Markdown text={revision.text || '_Prázdný popis._'} />}
      {!locked && revision.text !== current && <ActionButton className="btn small" busyLabel="Obnovuji…" onClick={async () => { if (await s.act(`/items/${kind}/${id}/description`, { expectedVersion: version, text: revision.text })) { setHistoryOpen(false); setSelectedVersion(undefined) } }}>Obnovit jako novou verzi</ActionButton>}
    </div> : <Markdown text={current || '_Popis zatím není vyplněný._'} />}
    {!editing && <AttachmentList kind={kind} id={id} />}
  </section>
}

const AttachmentList = ({ kind, id, extra = [], onInsert }: { kind: DescriptionKind; id: string; extra?: ProjectAttachment[]; onInsert?: (a: ProjectAttachment) => void }) => {
  const s = useStudio()
  const assets = new Map([...attachmentsFor(s.project, kind, id), ...extra].map((a) => [a.id, a]))
  return assets.size > 0 ? <div className="description-attachments"><h4>Přílohy</h4>{[...assets.values()].map((a) => <div className="description-attachment" key={a.id}><a href={`/api/projects/${s.project.id}/attachments/${a.id}`} target="_blank" rel="noopener noreferrer">{a.name}</a><span className="small muted">{fileSize(a.size)}</span>{onInsert && <button type="button" className="link-btn small" onClick={() => onInsert(a)}>Vložit do textu</button>}</div>)}</div> : null
}

const MarkdownSourceEditor = ({ kind, id, initial, version, onClose }: { kind: DescriptionKind; id: string; initial: string; version: number; onClose: () => void }) => {
  const s = useStudio()
  const [baseVersion] = useState(version)
  const [text, setText] = useState(initial)
  const [preview, setPreview] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploads, setUploads] = useState<ProjectAttachment[]>([])
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [link, setLink] = useState<{ image: boolean; label: string; url: string }>()
  const textRef = useRef(initial)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const selection = useRef({ start: 0, end: 0 })
  const stale = descriptionVersion(s.project, kind, id) !== baseVersion
  const restoreSelection = (start: number, end: number) => requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(start, end) })
  const apply = (action: MarkdownAction) => {
    if (preview) return
    const { start, end } = selection.current
    if (action === 'link' || action === 'image') { setLink({ image: action === 'image', label: textRef.current.slice(start, end), url: '' }); return }
    const result = markdownEdit(text, start, end, action)
    textRef.current = result.value; setText(result.value); selection.current = { start: result.start, end: result.end }; restoreSelection(result.start, result.end)
  }
  const insertCode = (code: string) => {
    const old = textRef.current
    const start = Math.min(selection.current.start, old.length), end = Math.min(selection.current.end, old.length)
    const next = old.slice(0, start) + code + old.slice(end)
    selection.current = { start: start + code.length, end: start + code.length }; textRef.current = next; setText(next)
  }
  const insert = (a: ProjectAttachment) => {
    const label = a.name.replace(/[\[\]\\]/g, '\\$&')
    const code = `${a.mime.startsWith('image/') ? '!' : ''}[${label}](${attachmentRef(a.id)})`
    insertCode(code)
  }
  const upload = async (files: File[]) => {
    if (uploading || !files.length) return
    setUploading(true); setError('')
    try {
      if (!(await s.flush())) throw new Error('Nejprve uložte ostatní změny projektu.')
      for (const file of files) {
        if (!file.size || file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: maximální velikost je 20 MB, prázdný soubor nelze přiložit.`)
        const body = new FormData(); body.append('file', file)
        const response = await fetch(`/api/projects/${s.project.id}/items/${kind}/${encodeURIComponent(id)}/attachments`, { method: 'POST', body })
        const result = await response.json() as ProjectAttachment & { error?: string }
        if (!response.ok) throw new Error(result.error ?? 'Nahrání přílohy selhalo.')
        setUploads((old) => [...old, result]); insert(result)
      }
      await s.reload()
    } catch (e) { setError((e as Error).message) }
    finally { setUploading(false) }
  }
  return <div className={`markdown-editor ${dragging ? 'dragging' : ''}`} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true) } }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }} onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDragging(false); void upload([...e.dataTransfer.files]) }}>
    <div className="markdown-toolbar" role="toolbar" aria-label="Formátování Markdownu">
      <select className="field" aria-label="Vložit nadpis" value="" disabled={preview || uploading} onChange={(e) => apply(e.target.value as MarkdownAction)}><option value="" disabled>Nadpis</option>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={`h${n}`}>Nadpis {n}</option>)}</select>
      {TOOLS.map((tool) => <button type="button" key={tool.action} title={tool.label} aria-label={tool.label} className={`md-tool md-tool-${tool.action}`} disabled={preview || uploading} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(tool.action)}>{tool.text}</button>)}
      <button type="button" className="btn small" disabled={uploading} onClick={() => fileInput.current?.click()}><Glyph name="plus" />{uploading ? 'Nahrávám…' : 'Připojit soubor'}</button>
      <button type="button" className="btn small" onClick={() => setPreview(!preview)}>{preview ? 'Zdroj Markdownu' : 'Náhled'}</button>
    </div>
    <input ref={fileInput} className="visually-hidden" type="file" multiple aria-label="Připojit soubory" onChange={(e) => { void upload([...e.target.files ?? []]); e.target.value = '' }} />
    {preview ? <div className="markdown-live-preview"><Markdown text={text || '_Prázdný popis._'} /></div> : <textarea ref={textarea} className="field markdown-source" aria-label="Popis v Markdownu" rows={12} maxLength={200000} value={text} onChange={(e) => { textRef.current = e.target.value; setText(e.target.value) }} onSelect={(e) => { selection.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd } }} onKeyDown={(e) => {
      if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); apply(({ b: 'bold', i: 'italic', u: 'underline' } as const)[e.key.toLowerCase() as 'b' | 'i' | 'u']) }
    }} />}
    <p className="small muted">Markdown a HTML pro formátování. Obrázky i jiné přílohy můžete přetáhnout sem nebo připojit tlačítkem. Max. 20 MB na soubor.</p>
    <AttachmentList kind={kind} id={id} extra={uploads} onInsert={insert} />
    {error && <p role="alert">{error}</p>}{stale && <p role="alert">Popis mezitím někdo upravil. Váš rozepsaný text je zachován; před uložením načtěte novou verzi.</p>}
    <div className="row-gap"><button className="btn" type="button" disabled={uploading} onClick={onClose}>Zrušit</button><ActionButton className="btn primary" disabled={uploading || stale || text.length > 200000} busyLabel="Ukládám…" onClick={async () => { if (await s.act(`/items/${kind}/${id}/description`, { expectedVersion: baseVersion, text })) onClose() }}>Uložit popis</ActionButton></div>
    {link && <Dialog onClose={() => setLink(undefined)} width={440} label={link.image ? 'Vložit obrázek' : 'Vložit odkaz'}><form className="create-form" onSubmit={(e) => {
      e.preventDefault()
      if (!/^(https?:\/\/|\/[^/]|#|mailto:)/i.test(link.url)) return
      const label = (link.label || (link.image ? 'Obrázek' : link.url)).replace(/[\[\]\\]/g, '\\$&')
      insertCode(`${link.image ? '!' : ''}[${label}](${link.url.replaceAll('(', '%28').replaceAll(')', '%29')})`)
      setLink(undefined)
    }}><h3>{link.image ? 'Vložit obrázek z odkazu' : 'Vložit odkaz'}</h3><label className="review-field">Popis<input className="field" value={link.label} onChange={(e) => setLink({ ...link, label: e.target.value })} /></label><label className="review-field">URL<input autoFocus className="field" type="text" placeholder="https://…" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} /></label><div className="dialog-actions"><button type="button" className="btn" onClick={() => setLink(undefined)}>Zrušit</button><button className="btn primary" disabled={!/^(https?:\/\/|\/[^/]|#|mailto:)/i.test(link.url)}>Vložit</button></div></form></Dialog>}
  </div>
}
