import { useState } from 'react'
import type { HubStatus, ModelMetrics } from '@aforge/shared'
import { api } from '../api'

const FIELDS = ['contextWindow', 'inputUsdPerMillion', 'cachedInputUsdPerMillion', 'outputUsdPerMillion'] as const
const LABELS = ['Kontextové okno', 'Vstup USD / 1M', 'Cache USD / 1M', 'Výstup USD / 1M']
type Row = { model: string; values: string[] }
export const ModelRates = ({ hub, onSaved }: { hub: HubStatus; onSaved: (h: HubStatus) => void }) => {
  const [rows, setRows] = useState<Row[]>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const initial = () => [...new Set([...Object.keys(hub.modelMetrics ?? {}), ...hub.runs.flatMap((r) => r.usage.model ? [r.usage.model] : [])])].map((model) => ({ model, values: FIELDS.map((k) => hub.modelMetrics?.[model]?.[k]?.toString() ?? '') }))
  const save = async () => {
    const body: Record<string, ModelMetrics> = {}
    setError(''); setSaving(true); setSaved(false)
    try {
      for (const row of rows ?? []) {
        if (!row.model.trim()) throw new Error('Vyplňte id modelu nebo řádek odeberte.')
        const model = row.model.trim()
        if (Object.hasOwn(body, model)) throw new Error('Každý model smí mít jen jeden řádek.')
        const values: ModelMetrics = {}
        FIELDS.forEach((key, i) => {
          const text = row.values[i]?.trim()
          if (!text) return
          const value = Number(text.replace(',', '.'))
          if (!Number.isFinite(value) || value < 0) throw new Error('Sazby musí být nezáporná čísla.')
          values[key] = value
        })
        Object.defineProperty(body, model, { value: values, enumerable: true })
      }
      onSaved(await api<HubStatus>('/hub/model-metrics', { method: 'PUT', body }))
      setSaved(true)
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }
  return <details className="model-rates" onToggle={(e) => { if (e.currentTarget.open && rows === undefined) setRows(initial()) }}>
    <summary>Sazby a kontextová okna modelů</summary>
    <p className="muted">Doplňte přesné id modelu a své sazby v USD za milion tokenů. Prázdná hodnota znamená neznámou, nula bezplatnou. Hlášená cena z CLI má přednost. Změna přepočítá i uložené běhy; proměnné serveru mají přednost před tímto nastavením.</p>
    <div className="agent-runs-table-wrap"><table className="agent-runs-table"><thead><tr><th>Model</th>{LABELS.map((l) => <th key={l}>{l}</th>)}<th /></tr></thead><tbody>
      {rows?.map((row, i) => <tr key={i}><td><input className="field mono" aria-label={`Model ${i + 1}`} value={row.model} disabled={saving} onChange={(e) => { setSaved(false); setRows(rows.map((r, n) => n === i ? { ...r, model: e.target.value } : r)) }} /></td>
        {FIELDS.map((key, j) => <td key={key}><input className="field" inputMode="decimal" aria-label={`${LABELS[j]} pro ${row.model || `model ${i + 1}`}`} value={row.values[j]} disabled={saving} placeholder="Neznámá" onChange={(e) => { setSaved(false); setRows(rows.map((r, n) => n === i ? { ...r, values: r.values.map((v, m) => m === j ? e.target.value : v) } : r)) }} /></td>)}
        <td><button className="btn small" disabled={saving} onClick={() => { setSaved(false); setRows(rows.filter((_, n) => n !== i)) }}>Odebrat</button></td></tr>)}
    </tbody></table></div>
    <div className="model-rates-actions"><button className="btn" disabled={saving} onClick={() => { setSaved(false); setRows([...(rows ?? []), { model: '', values: ['', '', '', ''] }]) }}>Přidat model</button><button className="btn primary" disabled={saving} onClick={() => void save()}>{saving ? 'Ukládám…' : 'Uložit sazby'}</button>{saved && <span role="status">Sazby uloženy</span>}</div>
    {error && <p role="alert">{error}</p>}
  </details>
}
