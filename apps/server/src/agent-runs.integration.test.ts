// Real child processes and encrypted relay transport, using fake CLIs so tests never spend tokens.
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import net from 'node:net'
import { expect, it } from 'vitest'

it('unifies local and remote calls, forwards worker usage and tracks concrete worker assignments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aforge-telemetry-integration-'))
  const root = resolve(import.meta.dirname, '../../..')
  const port = await new Promise<number>((done) => {
    const socket = net.createServer().listen(0, '127.0.0.1', () => { const port = (socket.address() as net.AddressInfo).port; socket.close(() => done(port)) })
  })
  await mkdir(join(dir, 'bin'))
  await mkdir(join(dir, 'data'))
  await writeFile(join(dir, 'bin', 'claude'), `#!/usr/bin/env node
process.stdin.resume(); process.stdin.on('end', () => {
 console.log(JSON.stringify({type:'assistant',message:{model:'test-claude',usage:{input_tokens:30,output_tokens:10}}}));
 setTimeout(()=>console.log(JSON.stringify({type:'result',structured_output:{reply:'ok'},usage:{input_tokens:30,output_tokens:10},total_cost_usd:0.004,modelUsage:{'test-claude':{contextWindow:1000}}})),300);
});`, { mode: 0o755 })
  await writeFile(join(dir, 'bin', 'codex'), `#!/usr/bin/env node
console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:100,output_tokens:10,cached_input_tokens:80}}));`, { mode: 0o755 })
  const script = `
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { z } from ${JSON.stringify(join(root, 'node_modules/zod/index.js'))};
const root=${JSON.stringify(root)}, dir=${JSON.stringify(dir)}, port=${port};
const children=[];
const child=(args,env={})=>{const p=spawn(process.execPath,['--import','tsx',...args],{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']}); children.push(p);return p};
const wait=async(check)=>{const until=Date.now()+10000;while(!check()){if(Date.now()>until)throw Error('Timed out waiting for telemetry');await new Promise(r=>setTimeout(r,25));}};
try {
 const relay=child(['apps/relay/src/index.ts'],{PORT:String(port)});
 let ready=false;relay.stdout.on('data',()=>ready=true);await wait(()=>ready);
 const {hub}=await import(${JSON.stringify(join(root, 'apps/server/src/hub.ts'))});
 const {structured}=await import(${JSON.stringify(join(root, 'apps/server/src/agents.ts'))});
 const {agentRuns}=await import(${JSON.stringify(join(root, 'apps/server/src/agent-runs.ts'))});
 const {createProject}=await import(${JSON.stringify(join(root, 'apps/server/src/store.ts'))});
 const {ensureRepo}=await import(${JSON.stringify(join(root, 'apps/server/src/workspace.ts'))});
 const {runAgent}=await import(${JSON.stringify(join(root, 'apps/server/src/build.ts'))});
 const context={projectId:'test',projectName:'Telemetry test',step:'Pipeline · t2 · Review'};
 assert.deepEqual(await structured(z.object({reply:z.string()}),'system','hello',context),{reply:'ok'});
 assert.equal(agentRuns.list()[0].location,'local');assert.equal(agentRuns.list()[0].usage.contextTokens,40);
 hub.configure({relay:'ws://127.0.0.1:'+port,mode:'remote'});await wait(()=>hub.status().connected);
 const token=hub.enroll('Test worker');
 const enroll=child(['apps/worker/src/cli.ts','enroll',token,'--name','Test worker','--labels','build,review']);
 await new Promise((done,fail)=>{enroll.once('exit',code=>code===0?done():fail(Error('Enrollment failed')))});
 child(['apps/worker/src/cli.ts','run']);await wait(()=>hub.status().workers.some(w=>w.online));
 const remote=structured(z.object({reply:z.string()}),'system','hello',context);
 await wait(()=>hub.status().runs.some(r=>r.location==='remote'&&r.state==='running'));
 const active=hub.status().runs.find(r=>r.location==='remote'&&r.state==='running');
 assert.equal(active.host,'Test worker');assert.equal(active.step,context.step);assert.ok(active.workerId);
 assert.equal(hub.status().workers[0].running,1);
 await remote;
 const run=agentRuns.list().find(r=>r.location==='remote');
 assert.equal(run.state,'done');assert.equal(run.usage.inputTokens,30);assert.equal(run.usage.contextWindow,1000);assert.equal(run.usage.costUsd,0.004);
 const project=await createProject('Build telemetry','');await ensureRepo(project.id);
 assert.equal(await runAgent(project.id,{agent:'codex',prompt:'No changes',message:'Test build',step:'Pipeline · t3 · Implementace',onEvent:()=>{},setKill:()=>{}}),true);
 const build=agentRuns.list().find(r=>r.agent==='codex');assert.equal(build.state,'done');assert.equal(build.workerId,run.workerId);assert.equal(build.usage.cachedInputTokens,80);
 assert.equal(hub.status().workers[0].running,0);
 console.log('TELEMETRY_INTEGRATION_OK');
} catch(e) { console.error(e); process.exitCode=1 }
finally { for(const p of children) p.kill('SIGTERM');setTimeout(()=>process.exit(process.exitCode??0),100) }
`
  const env: NodeJS.ProcessEnv = { ...process.env, AFORGE_DATA: join(dir, 'data'), AFORGE_WORKER_HOME: join(dir, 'worker'), PATH: `${join(dir, 'bin')}:${process.env.PATH}` }
  delete env.ANTHROPIC_API_KEY
  const processUnderTest = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  processUnderTest.stdout.on('data', (d) => output += d)
  processUnderTest.stderr.on('data', (d) => output += d)
  try {
    const code = await new Promise((done) => processUnderTest.once('exit', done))
    expect(output).toContain('TELEMETRY_INTEGRATION_OK')
    expect(code, output).toBe(0)
  } finally { processUnderTest.kill('SIGTERM'); await rm(dir, { recursive: true, force: true }) }
}, 30000)
