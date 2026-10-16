// Blocks: the low-code model between stories and code (pages, components, API endpoints, entities,
// workflow steps, integrations, jobs) as an editable graph.
import { useEffect, useMemo, useState } from 'react'
import { applyNodeChanges, Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { BLOCK_KINDS, type BlockNode } from '@aforge/shared'
import { uid } from '../api'
import { Icon } from '../icons'
import { useStudio } from '../studio'

const KIND: Record<BlockNode['kind'], { label: string; color: string }> = {
  page: { label: 'Stránka', color: 'var(--accent)' },
  component: { label: 'Komponenta', color: 'var(--teal)' },
  api: { label: 'API', color: 'var(--purple)' },
  entity: { label: 'Entita', color: 'var(--orange)' },
  workflow: { label: 'Workflow', color: 'var(--green)' },
  integration: { label: 'Integrace', color: 'var(--pink)' },
  job: { label: 'Job', color: 'var(--label-2)' },
}

type BlockData = { block: BlockNode }

const BlockView = ({ data, selected }: NodeProps<Node<BlockData>>) => {
  const k = KIND[data.block.kind]
  return (
    <div className={`block-node ${selected ? 'selected' : ''}`} style={{ borderTop: `3px solid ${k.color}` }}>
      <Handle type="target" position={Position.Left} />
      <div className="kind" style={{ color: k.color }}>
        {k.label}
        {data.block.storyIds.length > 0 && <span className="chip gray" style={{ marginLeft: 'auto', textTransform: 'none' }}>{data.block.storyIds.join(', ')}</span>}
      </div>
      <div className="label">{data.block.label}</div>
      {data.block.description && <div className="desc">{data.block.description}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

const nodeTypes = { block: BlockView }

export const BlocksStage = () => {
  const s = useStudio()
  const { nodes: blocks, edges } = s.project.blocks
  const selected = blocks.find((b) => b.id === s.focus.blockId)

  // React Flow keeps measured sizes on its nodes, so they live in local state synced from the model.
  const [nodes, setNodes] = useState<Node<BlockData>[]>([])
  useEffect(() => {
    setNodes((prev) =>
      blocks.map((b) => ({
        ...prev.find((n) => n.id === b.id),
        id: b.id,
        type: 'block',
        position: { x: b.x, y: b.y },
        data: { block: b },
        selected: b.id === s.focus.blockId,
      })),
    )
  }, [blocks, s.focus.blockId])
  const flowEdges = useMemo<Edge[]>(
    () => edges.map((e) => ({ id: e.id, source: e.from, target: e.to, label: e.label || undefined, animated: false })),
    [edges],
  )

  const setBlocks = (fn: (b: typeof s.project.blocks) => typeof s.project.blocks) => s.update((p) => ({ ...p, blocks: fn(p.blocks) }))
  const updateBlock = (id: string, patch: Partial<BlockNode>) => setBlocks((b) => ({ ...b, nodes: b.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }))

  const add = (kind: BlockNode['kind']) => {
    const node: BlockNode = { id: uid('blk'), kind, label: KIND[kind].label, description: '', x: 40 + (blocks.length % 5) * 260, y: 40 + Math.floor(blocks.length / 5) * 140, storyIds: [] }
    setBlocks((b) => ({ ...b, nodes: [...b.nodes, node] }))
    s.setFocus({ ...s.focus, blockId: node.id })
  }

  return (
    <>
      <div className="pane-bar">
        <h2>Bloky</h2>
        {BLOCK_KINDS.map((k) => (
          <button key={k} className="tool-btn" onClick={() => add(k)}>
            <span className="dot" style={{ background: KIND[k].color }} /> {KIND[k].label}
          </button>
        ))}
        <span className="spacer" />
        <button className="btn primary" disabled={s.agentBusy || !s.project.stories.length} onClick={() => void s.askAgent({ intent: 'blocks' })}>
          <Icon.sparkles /> Vygenerovat ze stories
        </button>
      </div>
      <div className="split">
        <div style={{ position: 'relative' }}>
          {blocks.length === 0 && (
            <div className="empty" style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none' }}>
              <div>
                Zatím žádné bloky.
                <p>Nechte agenta převést stories a wireframy na stránky, API, entity a workflow.</p>
              </div>
            </div>
          )}
          <ReactFlow
            nodes={nodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, n) => s.setFocus({ ...s.focus, blockId: n.id })}
            onPaneClick={() => s.setFocus({ ...s.focus, blockId: undefined })}
            onNodesChange={(changes) => {
              setNodes((n) => applyNodeChanges(changes, n))
              for (const c of changes) {
                if (c.type === 'position' && c.position) updateBlock(c.id, { x: Math.round(c.position.x), y: Math.round(c.position.y) })
                if (c.type === 'remove') setBlocks((b) => ({ nodes: b.nodes.filter((n) => n.id !== c.id), edges: b.edges.filter((e) => e.from !== c.id && e.to !== c.id) }))
              }
            }}
            onEdgesChange={(changes) => {
              for (const c of changes) if (c.type === 'remove') setBlocks((b) => ({ ...b, edges: b.edges.filter((e) => e.id !== c.id) }))
            }}
            onConnect={(c) => c.source && c.target && setBlocks((b) => ({ ...b, edges: [...b.edges, { id: uid('edge'), from: c.source, to: c.target, label: '' }] }))}
          >
            <Background gap={16} size={1} />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="inspector">
          {selected ? (
            <>
              <h3>Blok</h3>
              <div className="group-box">
                <div className="form-row" style={{ gridTemplateColumns: '60px 1fr' }}>
                  <label>Druh</label>
                  <select className="field" value={selected.kind} onChange={(e) => updateBlock(selected.id, { kind: e.target.value as BlockNode['kind'] })}>
                    {BLOCK_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND[k].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row" style={{ gridTemplateColumns: '60px 1fr' }}>
                  <label>Název</label>
                  <input className="field" value={selected.label} onChange={(e) => updateBlock(selected.id, { label: e.target.value })} />
                </div>
                <div className="form-row top" style={{ gridTemplateColumns: '60px 1fr' }}>
                  <label>Popis</label>
                  <textarea className="field" rows={5} value={selected.description} placeholder="Např. GET /api/orders?status=… vrací stránkovaný seznam" onChange={(e) => updateBlock(selected.id, { description: e.target.value })} />
                </div>
              </div>
              <h3>Stories</h3>
              <div className="group-box">
                {s.project.stories.map((st) => (
                  <label key={st.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 0' }}>
                    <input
                      type="checkbox"
                      checked={selected.storyIds.includes(st.id)}
                      onChange={(e) => updateBlock(selected.id, { storyIds: e.target.checked ? [...selected.storyIds, st.id] : selected.storyIds.filter((x) => x !== st.id) })}
                    />
                    <span className="chip gray">{st.id}</span> {st.title}
                  </label>
                ))}
              </div>
              <button
                className="btn danger"
                onClick={() => {
                  setBlocks((b) => ({ nodes: b.nodes.filter((n) => n.id !== selected.id), edges: b.edges.filter((e) => e.from !== selected.id && e.to !== selected.id) }))
                  s.setFocus({ ...s.focus, blockId: undefined })
                }}
              >
                <Icon.trash /> Smazat blok
              </button>
            </>
          ) : (
            <div className="muted">
              Vyberte blok. Vazbu vytvoříte tažením z pravého úchytu na levý úchyt jiného bloku; Backspace maže vybraný blok nebo vazbu.
            </div>
          )}
        </div>
      </div>
    </>
  )
}
