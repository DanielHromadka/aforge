// Real containers and network filtering, no model/API calls and no production data.
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { sandboxProcess } from '../packages/runner/src/sandbox.ts'
import { run } from '../packages/runner/src/proc.ts'
const dir = await mkdtemp(join(tmpdir(), 'reactor-isolation-'))
const name = `reactor-egress-test-${randomUUID()}`
const docker = async (args) => { const r = await run('docker', args, { timeoutMs: 120000 }); if (r.code) throw new Error(r.stderr || r.stdout); return r.stdout.trim() }
try {
  await mkdir(join(dir, '.git')); await writeFile(join(dir, '.git/config'), '[core]\nrepositoryformatversion=0\n')
  await docker(['run', '-d', '--name', name, '--read-only', '--tmpfs', '/tmp', '--tmpfs', '/run', '--tmpfs', '/var/log/squid', '--tmpfs', '/var/spool/squid', '--cap-drop=ALL', '--security-opt=no-new-privileges', 'reactor-egress:latest'])
  process.env.AFORGE_AGENT_SANDBOX = 'docker'; process.env.AFORGE_EGRESS_PROXY = name
  process.env.OPENAI_API_KEY = 'fixture-not-a-real-key'; process.env.REACTOR_HOST_SECRET_FIXTURE = 'must-not-enter-job'
  let output = ''
  const source = `
    const fs=require('node:fs'),http=require('node:http');
    if(process.env.REACTOR_HOST_SECRET_FIXTURE) throw Error('Host secret leaked');
    if(fs.existsSync('/var/run/docker.sock')) throw Error('Docker socket leaked');
    let denied=false;try{fs.writeFileSync('/workspace/.git/config','bad')}catch{denied=true}if(!denied)throw Error('Git metadata writable');
    denied=false;try{fs.writeFileSync('/etc/host-escape','bad')}catch{denied=true}if(!denied)throw Error('Root filesystem writable');
    fs.writeFileSync('/workspace/result.txt','isolated');
    const request=(path)=>new Promise((resolve,reject)=>{const r=http.get({hostname:'egress',port:3128,path,headers:{host:new URL(path).host},timeout:20000},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});r.on('timeout',()=>r.destroy(Error('timeout')));r.on('error',reject)});
    (async()=>{for(const url of ['http://127.0.0.1/','http://169.254.169.254/','http://10.1.2.3/','http://egress/']){if(await request(url)!==403)throw Error('Private destination allowed: '+url)}
    const code=await new Promise((resolve,reject)=>{const r=http.request({hostname:'egress',port:3128,method:'CONNECT',path:'example.com:443',headers:{host:'example.com:443'},timeout:20000});r.on('connect',(res,socket)=>{socket.destroy();resolve(res.statusCode)});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('timeout')));r.end()});if(code!==200)throw Error('Public HTTPS egress failed '+code);
    console.log('isolation and egress passed')})().catch(e=>{console.error(e);process.exitCode=1});`
  const job = sandboxProcess('node', ['-e', source], dir, undefined, (line) => { output += line + '\n' }, { model: false })
  if (await job.done !== 0) throw new Error(output)
  if ((await readFile(join(dir, 'result.txt'), 'utf8')) !== 'isolated') throw new Error('Workspace output missing')
  console.log(output.trim())
  let modelOutput = ''
  const modelCheck = sandboxProcess('node', ['-e', `if(process.env.OPENAI_API_KEY!=='reactor-job-scoped-placeholder')throw Error('Provider credential leaked into job');require('node:http').get('http://model-gateway:8080/v1/models',r=>{if(r.statusCode!==404)process.exitCode=1;r.resume();console.log('Scoped model gateway passed')}).on('error',e=>{console.error(e);process.exitCode=1})`], dir, undefined, (line) => { modelOutput += line + '\n' })
  if (await modelCheck.done !== 0) throw new Error(modelOutput)
  console.log('Provider credential remained in its per-job gateway; no model was called.')
} finally {
  await run('docker', ['rm', '-f', name]); await rm(dir, { recursive: true, force: true })
}
