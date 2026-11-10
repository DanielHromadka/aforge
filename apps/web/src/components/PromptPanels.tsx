// The optional prompt of the open step, edited in a popover under the header. Every agent working in the
// step reads it; it may stay empty.
import type { Stage } from '@aforge/shared'
import { useStudio } from '../studio'

const HINT: Record<Stage, string> = {
  overview: 'Pokyny pro celý tým, např. jazyk aplikace nebo co je mimo rozsah.',
  prompt: 'Popište, co má agent připravit nebo změnit.',
  design: 'Co z designu platí a co ne, chování mimo Figmu, responzivita…',
  stories: 'Role uživatelů, pravidla, priority, co je mimo rozsah…',
  split: 'Stack, repozitáře, knihovny, jak dělit práci mezi FE a BE…',
  build: 'Konvence kódu, knihovny, co neměnit…',
  code: 'Pokyny pro úpravy kódu a revize…',
  preview: 'Na co se při kontrole běžící aplikace zaměřit…',
  tests: 'Co testovat, testovací data…',
  wiki: 'Pro koho wiki píšeme, tón, co vynechat…',
}

export const StepPrompt = () => {
  const s = useStudio()
  return (
    <div className="step-prompt">
      <label htmlFor="step-prompt">Prompt kroku {s.activeStep.label}</label>
      <textarea
        id="step-prompt"
        className="field"
        rows={5}
        autoFocus
        readOnly={s.readOnly}
        value={s.activeStep.prompt}
        placeholder={HINT[s.stage]}
        onChange={(e) => s.setStepPrompt(e.target.value)}
      />
    </div>
  )
}
