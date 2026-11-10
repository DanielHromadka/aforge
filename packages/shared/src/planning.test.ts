import { describe, expect, it } from 'vitest'
import { captureDescriptionHistory, descriptionOf, newProject, nextPlanningTime, planningNotices, planningTrigger, reorganizePlanning, type PlanningEntry, type Project, type Story } from './index.js'
const story: Story = { id: 'PT-1', title: 'Přehled', asA: '', iWant: '', soThat: '', acceptance: [], screenIds: [], priority: 'must', status: 'draft' }
const reminder: PlanningEntry = { id: 'alert', text: 'Zkontrolovat schválení', level: 'warning', remindAt: '2026-10-18T08:00:00Z', deadlineAt: '2026-10-18T12:00:00Z', createdAt: '', updatedAt: '' }
const project = (): Project => ({ ...newProject('planning', 'Planning'), stories: [story], planning: { 'story:PT-1': { version: 1, entries: [reminder], estimateMinutes: 90, updatedAt: '', updatedBy: 'ann' } } })
describe('human planning', () => {
  it('keeps future alerts quiet, survives late opening, and re-alerts at a deadline after a read reminder', () => {
    const p = project()
    expect(planningNotices(p, 'ann', Date.parse('2026-10-18T07:00:00Z'))).toEqual([])
    expect(nextPlanningTime(p, Date.parse('2026-10-18T07:00:00Z'))).toBe(Date.parse(reminder.remindAt!))
    const read = { ...reminder, readBy: { ann: '2026-10-18T09:00:00Z' } }
    p.planning!['story:PT-1']!.entries = [read]
    expect(planningNotices(p, 'ann', Date.parse('2026-10-18T10:00:00Z'))[0]).toMatchObject({ read: true, overdue: false })
    expect(planningNotices(p, 'bob', Date.parse('2026-10-18T10:00:00Z'))[0]!.read).toBe(false)
    expect(planningNotices(p, 'ann', Date.parse('2026-10-18T13:00:00Z'))[0]).toMatchObject({ read: false, overdue: true, dueAt: reminder.deadlineAt })
    expect(planningTrigger({ ...read, resolvedAt: 'now' }, Date.now())).toBeUndefined()
  })
  it('ignores deleted items, and retains notes during merges without duplicating estimates on splits', () => {
    const p = project()
    expect(planningNotices({ ...p, stories: [] }, 'ann', Date.parse('2026-10-19'))).toEqual([])
    const merged = reorganizePlanning(p, ['PT-1'], [], ['PT-2'], 'now')!
    expect(merged['story:PT-2']).toMatchObject({ estimateMinutes: 90, entries: [{ text: reminder.text }] })
    const split = reorganizePlanning(p, ['PT-1'], [], ['PT-2', 'PT-3'], 'now')!
    expect(split['story:PT-2']!.estimateMinutes).toBeUndefined()
    expect(split['story:PT-3']!.entries[0]!.text).toBe(reminder.text)
  })
})
describe('description revision capture', () => {
  it('captures originals, preserves all versions, and records restoration as another save', () => {
    const p = { ...project(), stories: [{ ...story, description: 'Původní' }] }
    const changed = captureDescriptionHistory(p, { ...p, stories: [{ ...story, description: '**Nový**' }] }, 'Anna', '2026-10-18T10:00:00Z')
    expect(changed.descriptionHistory!['story:PT-1']!.map((r) => r.text)).toEqual(['Původní', '**Nový**'])
    const restored = captureDescriptionHistory(changed, { ...changed, stories: [{ ...story, description: 'Původní' }] }, 'Bob', '2026-10-18T11:00:00Z')
    expect(restored.descriptionHistory!['story:PT-1']!.map((r) => r.author)).toEqual(['Původní verze', 'Anna', 'Bob'])
    expect(descriptionOf(restored, 'story', 'PT-1')).toBe('Původní')
    expect(captureDescriptionHistory(restored, restored, 'Bob', 'later').descriptionHistory).toEqual(restored.descriptionHistory)
  })
})
