import { describe, expect, it } from 'vitest'
import { newProject, normalizeProject, workflowOf, workflowPreset, withWorkflowSteps, WorkflowSchema, workflowInstructions, sectionPromptsOf } from './index.js'

describe('session workflows', () => {
  it('migrates existing prompts into Enterprise without modifying the source project', () => {
    const p = { ...newProject('x', 'X'), prompts: { stories: 'Existing requirements', blocks: 'Architecture constraints' } }
    const next = normalizeProject(p)
    expect(next.workflow?.preset).toBe('enterprise')
    expect(next.workflow?.steps.map((s) => s.kind)).toEqual(['overview', 'design', 'stories', 'split', 'build', 'preview', 'tests', 'wiki'])
    expect(next.workflow?.steps.find((s) => s.kind === 'stories')?.prompt).toBe('Existing requirements')
    expect(next.prompts.blocks).toBe('Architecture constraints')
    expect(p).not.toHaveProperty('workflow')
  })
  it('keeps prompts and custom step identities through preset switches and removal', () => {
    let w = workflowPreset('vibe', workflowOf(newProject('x', 'X')))
    w.steps[0]!.prompt = 'Build a calendar'
    const custom = { id: 'custom-review', kind: 'prompt' as const, label: 'Review', prompt: 'Check accessibility' }
    w = withWorkflowSteps(w, [...w.steps, custom])
    w = workflowPreset('enterprise', w)
    expect(w.retained).toContainEqual(custom)
    w = workflowPreset('developer', w)
    expect(w.steps[0]?.prompt).toBe('Build a calendar')
    expect(w.steps.map((s) => s.kind)).toEqual(['prompt', 'code', 'preview', 'tests'])
    w = withWorkflowSteps(w, [custom, ...w.steps])
    expect(w.steps[0]).toEqual(custom)
    expect(w.retained.some((s) => s.id === custom.id)).toBe(false)
  })
  it('accepts multiple independent empty prompt steps but rejects empty workflows and duplicate builtins or ids', () => {
    const base = workflowPreset('vibe', workflowOf(newProject('x', 'X')))
    expect(WorkflowSchema.safeParse(withWorkflowSteps(base, [{ id: 'a', kind: 'prompt', label: 'A', prompt: '' }, { id: 'b', kind: 'prompt', label: 'B', prompt: '' }])).success).toBe(true)
    expect(WorkflowSchema.safeParse({ ...base, steps: [] }).success).toBe(false)
    expect(WorkflowSchema.safeParse({ ...base, steps: [base.steps[1], { ...base.steps[1], id: 'another-preview' }] }).success).toBe(false)
    expect(WorkflowSchema.safeParse({ ...base, steps: [base.steps[0], base.steps[0]] }).success).toBe(false)
  })
  it('omits retained prompts from agent instructions while preserving build sub-section prompts', () => {
    const p = { ...newProject('x', 'X'), prompts: { stories: 'Hidden requirements', blocks: 'Active architecture' } }
    p.workflow = workflowPreset('vibe', workflowOf(p))
    p.workflow.steps[0]!.prompt = 'Current request'
    expect(workflowInstructions(p)).toContain('Current request')
    expect(workflowInstructions(p)).not.toContain('Hidden requirements')
    expect(sectionPromptsOf(p)).not.toHaveProperty('stories')
    p.workflow = workflowPreset('enterprise', p.workflow)
    expect(sectionPromptsOf(p).blocks).toBe('Active architecture')
  })
})
