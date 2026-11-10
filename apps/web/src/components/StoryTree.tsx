import { useState } from 'react'
import { buildStoryTree, type StoryTreeNode } from '../storyTree'
import { useStudio } from '../studio'
import { useCollapsed } from './Work'
import { Glyph, TypeIcon } from './Glyphs'
import { PlanningSummary } from './Planning'

export const StoryTree = ({ onNavigate }: { onNavigate: () => void }) => {
  const s = useStudio()
  const groups = useCollapsed()
  const [query, setQuery] = useState('')
  const [hidden, setHidden] = useState(false)
  const tree = buildStoryTree(s.project)
  const selected = s.focus.storyId
  const navigate = (id?: string) => { onNavigate(); s.setFocus({ ...s.focus, storyId: id }) }
  const q = query.trim().toLocaleLowerCase('cs')
  const matches = (n: StoryTreeNode): boolean => `${n.id} ${n.title}`.toLocaleLowerCase('cs').includes(q) || n.children.some(matches)
  const containsSelected = (n: StoryTreeNode): boolean => n.id === selected || n.children.some(containsSelected)
  const expandAll = (open: boolean) => {
    const visit = (n: StoryTreeNode) => { if (n.children.length) groups.toggle(`story-tree:${n.id}`, open); n.children.forEach(visit) }
    tree.forEach(visit)
  }
  const row = (node: StoryTreeNode, level: number): React.ReactNode => {
    const open = !!q || groups.isOpen(`story-tree:${node.id}`, level === 0 || containsSelected(node))
    const children = node.children.filter((child) => !q || matches(child))
    return <li key={node.id}>
      <div className={`story-tree-row ${selected === node.id ? 'selected' : ''}`} style={{ paddingInlineStart: 8 + level * 15 }}>
        {node.children.length > 0 ? <button className="tree-disclosure" aria-label={`${open ? 'Sbalit' : 'Rozbalit'} ${node.title}`} aria-expanded={open} onClick={() => groups.toggle(`story-tree:${node.id}`, !open)}><span className={`chev ${open ? 'open' : ''}`}>›</span></button> : <span className="tree-disclosure-space" />}
        <button className="story-tree-item" aria-current={selected === node.id ? 'page' : undefined} title={`${node.id.startsWith('__') ? '' : `${node.id} · `}${node.title}`} onClick={() => node.kind === 'folder' ? groups.toggle(`story-tree:${node.id}`, !open) : navigate(node.id)}>
          {node.kind === 'folder' ? <Glyph name="board" size={14} /> : node.kind === 'test' ? <Glyph name="test" size={14} /> : <TypeIcon type={node.kind} size={14} />}
          <span className="story-tree-label">{!node.id.startsWith('__') && node.kind !== 'test' && <span className="key">{node.id} </span>}{node.title}</span>
          {node.kind !== 'folder' && <PlanningSummary kind={node.kind === 'task' || node.kind === 'bug' || node.kind === 'subtask' ? 'issue' : node.kind} id={node.id} />}
          {node.children.length > 0 && <span className="small num muted">{node.children.length}</span>}
        </button>
      </div>
      {open && children.length > 0 && <ul>{children.map((child) => row(child, level + 1))}</ul>}
    </li>
  }
  return <aside className={`story-tree ${hidden ? 'collapsed' : ''}`} aria-label="Struktura projektu">
    <div className="story-tree-head"><button className="tool-btn" title={hidden ? 'Zobrazit strukturu' : 'Skrýt strukturu'} onClick={() => setHidden(!hidden)}><Glyph name="board" /></button>{!hidden && <><b>Struktura</b><span className="spacer" /><button className="tool-btn" title="Rozbalit vše" onClick={() => expandAll(true)}>＋</button><button className="tool-btn" title="Sbalit vše" onClick={() => expandAll(false)}>−</button></>}</div>
    {!hidden && <><div className="story-tree-tools"><input className="field" type="search" aria-label="Hledat ve struktuře" placeholder="Hledat ve struktuře…" value={query} onChange={(e) => setQuery(e.target.value)} /><button className={`story-tree-board ${!selected ? 'selected' : ''}`} onClick={() => navigate()}><Glyph name="board" /> Všechny stories</button></div><nav className="pane-scroll" aria-label="Epicy, stories a práce"><ul className="story-tree-list">{tree.filter((n) => !q || matches(n)).map((n) => row(n, 0))}</ul>{!tree.length && <p className="small muted">Přidejte první epic nebo story.</p>}{!!tree.length && !tree.some(matches) && <p className="small muted">Žádná položka neodpovídá hledání.</p>}</nav></>}
  </aside>
}
