import { z } from 'zod'
import { descriptionOf, descriptionVersion, itemOf, type DescriptionKind } from '@aforge/shared'
import { mutateProject } from './store.js'
import { publish } from './events.js'

export const DescriptionKindSchema = z.enum(['epic', 'story'])
export const saveDescription = async (projectId: string, kind: DescriptionKind, id: string, raw: unknown, author: string) => {
  const input = z.object({ expectedVersion: z.number().int().nonnegative(), text: z.string().max(200_000) }).parse(raw)
  const p = await mutateProject(projectId, (p) => {
    if (!itemOf(p, kind, id)) throw new Error('Položka už neexistuje.')
    if (descriptionVersion(p, kind, id) !== input.expectedVersion) throw Object.assign(new Error('Popis mezitím někdo změnil. Načtěte aktuální verzi před uložením.'), { statusCode: 409 })
    if (descriptionOf(p, kind, id) === input.text) return p
    return kind === 'epic' ? { ...p, epics: p.epics!.map((e) => e.id === id ? { ...e, description: input.text } : e) }
      : { ...p, stories: p.stories.map((s) => s.id === id ? { ...s, description: input.text } : s) }
  }, author)
  publish(projectId, 'project', 'changed', '')
  return p
}
