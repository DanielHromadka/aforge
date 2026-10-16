// The consultant: a structured reply with proposals. It runs on a remote worker when the hub is set to
// "remote", otherwise through the Anthropic API (ANTHROPIC_API_KEY) or the local Claude Code login.
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { AgentReplySchema, type AgentReply } from '@aforge/shared'
import { consultCli, detectCapabilities, run } from '@aforge/runner'
import { hub } from './hub.js'

const MODEL = process.env.AFORGE_MODEL ?? 'claude-opus-5-5'

export const jsonSchemaOf = (schema: z.ZodType): Record<string, unknown> => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>
  return rest
}

const replyJsonSchema = jsonSchemaOf(AgentReplySchema)

export const parseWith = <T>(schema: z.ZodType<T>, raw: unknown): T => {
  const parsed = schema.safeParse(typeof raw === 'string' ? JSON.parse(raw) : raw)
  if (!parsed.success) throw new Error(`Agent vrátil odpověď mimo schéma: ${parsed.error.message.slice(0, 400)}`)
  return parsed.data
}

/** Structured answer through the Anthropic API, with the server-side refusal fallback. */
const structuredViaApi = async (system: string, prompt: string, schema: Record<string, unknown>): Promise<unknown> => {
  const client = new Anthropic()
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: prompt }],
  })
  const message = await stream.finalMessage()
  if (message.stop_reason === 'refusal') throw new Error('Model požadavek odmítl.')
  if (message.stop_reason === 'max_tokens') throw new Error('Odpověď agenta byla příliš dlouhá a byla useknuta.')
  return JSON.parse(message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(''))
}

/** Any structured request: remote worker, Anthropic API or local Claude Code, in that order of choice. */
export const structured = async <T>(schema: z.ZodType<T>, system: string, prompt: string, opts: { labels?: string[] } = {}): Promise<T> => {
  const json = jsonSchemaOf(schema)
  if (hub.mode() === 'remote') {
    const raw = await hub.run({ kind: 'consult', system, prompt, schema: json }, { needs: 'claude', labels: opts.labels })
    return parseWith(schema, raw)
  }
  return parseWith(schema, process.env.ANTHROPIC_API_KEY ? await structuredViaApi(system, prompt, json) : await consultCli(system, prompt, json))
}

export const consult = (system: string, prompt: string): Promise<AgentReply> => structured(AgentReplySchema, system, prompt)

export { replyJsonSchema }

export const detectProviders = async () => {
  const caps = await detectCapabilities()
  const runtimeImage = caps.docker && (await run('docker', ['image', 'inspect', 'aforge-runtime:latest'])).code === 0
  return { claude: caps.claude, codex: caps.codex, docker: caps.docker, runtimeImage, anthropicApi: Boolean(process.env.ANTHROPIC_API_KEY) }
}
