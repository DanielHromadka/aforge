// One consultant exchange: build the context, ask the agent, store both messages in the thread.
import { randomUUID } from 'node:crypto'
import { applyOps, type ChatMessage, type Stage } from '@aforge/shared'
import { consult } from './agents.js'
import { buildContext, CONSULTANT_SYSTEM, type Focus } from './context.js'
import { loadChat, loadProject, saveChat, saveProject } from './store.js'
import { commit, removeFile, writeText } from './workspace.js'

// Chat writes for one project go through a queue, so parallel pipeline tasks never lose a message.
const queues = new Map<string, Promise<unknown>>()
const serial = <T>(projectId: string, fn: () => Promise<T>): Promise<T> => {
  const next = (queues.get(projectId) ?? Promise.resolve()).then(fn, fn)
  queues.set(projectId, next.catch(() => {}))
  return next
}

export const askConsultant = async (projectId: string, text: string, focus: Focus): Promise<[ChatMessage, ChatMessage]> => {
  const project = await loadProject(projectId)
  const stage: Stage = focus.stage
  const userMsg: ChatMessage = { id: randomUUID(), role: 'user', text, stage, proposals: [], conflicts: [], createdAt: new Date().toISOString() }
  const context = await buildContext(project, focus, await loadChat(projectId))
  const reply = await consult(CONSULTANT_SYSTEM, `${context}\n\n<user_request stage="${stage}">\n${text}\n</user_request>`)
  const agentMsg: ChatMessage = {
    id: randomUUID(),
    role: 'agent',
    text: reply.reply,
    stage,
    proposals: reply.proposals.map((p) => ({ ...p, id: `${p.id}-${randomUUID().slice(0, 4)}`, status: 'pending' as const })),
    conflicts: reply.conflicts,
    createdAt: new Date().toISOString(),
  }
  await serial(projectId, async () => saveChat(projectId, [...(await loadChat(projectId)), userMsg, agentMsg]))
  return [userMsg, agentMsg]
}

/** Accepts or rejects one proposal; accepting applies its model ops and writes and commits its files. */
export const decideProposal = (projectId: string, msgId: string, proposalId: string, accept: boolean) =>
  serial(projectId, async () => {
    const chat = await loadChat(projectId)
    const proposal = chat.find((m) => m.id === msgId)?.proposals.find((p) => p.id === proposalId)
    if (!proposal) throw new Error('Návrh nenalezen')
    if (proposal.status !== 'pending') throw new Error('Návrh už byl vyřízen')
    let project = await loadProject(projectId)
    if (accept) {
      project = await saveProject(applyOps(project, proposal.ops))
      let files = 0
      for (const op of proposal.ops) {
        if (op.type === 'file.write') await writeText(projectId, op.path, op.content)
        else if (op.type === 'file.delete') await removeFile(projectId, op.path)
        else continue
        files++
      }
      if (files) await commit(projectId, `aForge agent: ${proposal.title}`)
    }
    proposal.status = accept ? 'accepted' : 'rejected'
    await saveChat(projectId, chat)
    return { project, chat }
  })
