import { expect, it } from 'vitest'
import { newProject, workflowOf, workflowPreset, withWorkflowSteps } from '@aforge/shared'
import { renderSpec } from './build.js'
import { userPrompts } from './generate.js'

it('passes custom step prompts to implementation and generation and excludes removed prompts', () => {
  const project = newProject('test', 'Test')
  const base = workflowPreset('developer', workflowOf(project))
  project.workflow = withWorkflowSteps(base, [...base.steps, { id: 'review', kind: 'prompt', label: 'Accessibility review', prompt: 'Support keyboard navigation.' }])
  project.workflow.retained.push({ id: 'unused', kind: 'prompt', label: 'Removed', prompt: 'Removed instruction.' })
  const spec = renderSpec(project, 'full')
  expect(spec).toContain('Accessibility review')
  expect(spec).toContain('Support keyboard navigation.')
  expect(spec).not.toContain('Removed instruction.')
  const generation = userPrompts(project, 'plan')
  expect(generation).toContain('Support keyboard navigation.')
  expect(generation).not.toContain('Removed instruction.')
})
