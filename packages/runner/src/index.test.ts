import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentUsage, BuildEvent } from '@aforge/shared'
import { consultCli, implement } from './index.js'

let dir: string | undefined
afterEach(async () => { vi.unstubAllEnvs(); if (dir) await rm(dir, { recursive: true, force: true }); dir = undefined })
const fake = async (name: string, source: string) => {
  dir ??= await mkdtemp(join(tmpdir(), 'aforge-cli-test-'))
  const bin = join(dir, 'bin'); await mkdir(bin, { recursive: true })
  await writeFile(join(bin, name), `#!/usr/bin/env node\n${source}`, { mode: 0o755 })
  vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
  return dir
}

describe('CLI telemetry without calling a model', () => {
  it('streams consultation usage while preserving the structured reply and stdin', async () => {
    await fake('claude', `let input=''; process.stdin.on('data', c=>input+=c); process.stdin.on('end',()=>{
      console.log(JSON.stringify({type:'assistant',message:{model:'test-claude',usage:{input_tokens:10,output_tokens:2}}}));
      console.log(JSON.stringify({type:'result',structured_output:{reply:input},usage:{input_tokens:10,output_tokens:2},total_cost_usd:0.001,modelUsage:{'test-claude':{contextWindow:1000}}}));
    });`)
    const usage: AgentUsage[] = []
    expect(await consultCli('system', 'hello', {}, (u) => usage.push(u))).toEqual({ reply: 'hello' })
    expect(usage[0]).toMatchObject({ model: 'test-claude', contextTokens: 12 })
    expect(usage[1]).toMatchObject({ inputTokens: 10, outputTokens: 2, costUsd: 0.001, contextWindow: 1000 })
  })
  it('reports usage even when a structured model call fails', async () => {
    await fake('claude', `process.stdout.write(JSON.stringify({type:'result',is_error:true,result:'limit',usage:{input_tokens:4,output_tokens:0},total_cost_usd:0}));process.exitCode=1`)
    const usage: AgentUsage[] = []
    await expect(consultCli('system', 'hello', {}, (u) => usage.push(u))).rejects.toThrow('limit')
    expect(usage[0]).toMatchObject({ inputTokens: 4, costUsd: 0 })
  })
  it('reads only the Codex thread announced by this process and closes the telemetry watcher', async () => {
    const home = await fake('codex', `const fs=require('node:fs'),p=require('node:path');
      const id='11111111-1111-1111-1111-111111111111';
      const day=new Date().toISOString().slice(0,10).split('-');const dir=p.join(process.env.CODEX_HOME,'sessions',...day);fs.mkdirSync(dir,{recursive:true});
      fs.writeFileSync(p.join(dir,'rollout-test-'+id+'.jsonl'),[
        {type:'turn_context',payload:{model:'gpt-test'}},
        {type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:100,output_tokens:10,cached_input_tokens:80},last_token_usage:{total_tokens:50},model_context_window:1000}}}
      ].map(JSON.stringify).join('\\n')+'\\n');
      console.log(JSON.stringify({type:'thread.started',thread_id:id}));
      console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:10,cached_input_tokens:80}}));`)
    vi.stubEnv('CODEX_HOME', home)
    const events: BuildEvent[] = []
    const job = implement('codex', home, 'hello', (e) => events.push(e))
    expect(await job.done).toBe(0)
    expect(events.filter((e) => e.kind === 'usage').at(-1)?.usage).toMatchObject({ model: 'gpt-test', inputTokens: 100, outputTokens: 10, contextTokens: 50, contextWindow: 1000 })
  })
})
