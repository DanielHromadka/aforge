// Encrypted local repository + real PostgreSQL restore; no cloud credentials or user data.
import { mkdtemp, mkdir, writeFile, rm, createReadStream, createWriteStream } from 'node:fs'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { run } from '../packages/runner/src/proc.ts'
const dir = await promisify(mkdtemp)(join(tmpdir(), 'reactor-backup-smoke-'))
const name = `reactor-backup-smoke-${randomUUID()}`
const files = `${name}-files`
const docker = async (args) => { const r = await run('docker', args, { timeoutMs: 180000 }); if (r.code) throw new Error(r.stderr); return r.stdout }
const streamCommand = async (args, input, output) => {
  const child = spawn('docker', args, { stdio: [input ? 'pipe' : 'ignore', output ? 'pipe' : 'ignore', 'pipe'] })
  let error = ''; child.stderr.on('data', (chunk) => error += chunk)
  const ended = new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(error))) })
  await Promise.all([ended, ...(input ? [pipeline(createReadStream(input), child.stdin)] : []), ...(output ? [pipeline(child.stdout, createWriteStream(output))] : [])])
}
const restic = (...args) => docker(['run', '--rm', '--network', 'none', '-e', 'RESTIC_PASSWORD=disposable-fixture-password', '-v', `${files}:/fixture`, 'restic/restic:0.18.1', '-r', '/fixture/repository', ...args])
try {
  await promisify(mkdir)(join(dir, 'data/projects/fixture/workspace'), { recursive: true })
  await promisify(writeFile)(join(dir, 'data/projects/fixture/project.json'), JSON.stringify({ id: 'fixture', stories: [] }))
  await promisify(writeFile)(join(dir, 'data/projects/fixture/workspace/source.txt'), 'restored source')
  await run('git', ['init', '-q'], { cwd: join(dir, 'data/projects/fixture/workspace') })
  await run('git', ['add', '.'], { cwd: join(dir, 'data/projects/fixture/workspace') })
  await run('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture'], { cwd: join(dir, 'data/projects/fixture/workspace') })
  await docker(['run', '-d', '--rm', '--name', name, '--network', 'none', '-e', 'POSTGRES_USER=keycloak', '-e', 'POSTGRES_DB=keycloak', '-e', 'POSTGRES_PASSWORD=disposable-password', 'postgres:17-bookworm'])
  for (let attempt = 0; attempt < 90; attempt++) { if ((await run('docker', ['exec', name, 'pg_isready', '-U', 'keycloak', '-d', 'keycloak'])).code === 0) break; await setTimeout(500) }
  await docker(['exec', name, 'psql', '-U', 'keycloak', '-d', 'keycloak', '-c', "CREATE TABLE fixture(value text); INSERT INTO fixture VALUES ('restored');"])
  await streamCommand(['exec', name, 'pg_dump', '-U', 'keycloak', '-d', 'keycloak', '-Fc'], undefined, join(dir, 'postgres.dump'))
  await docker(['run', '-d', '--name', files, '--network', 'none', '-v', `${files}:/fixture`, 'node:22-bookworm-slim', 'tail', '-f', '/dev/null'])
  await docker(['cp', `${dir}/.`, `${files}:/fixture/`])
  await restic('init')
  await restic('backup', '/fixture/data', '/fixture/postgres.dump', '--tag', 'reactor')
  await restic('check')
  await restic('restore', 'latest', '--tag', 'reactor', '--target', '/fixture/restored')
  await docker(['cp', `${files}:/fixture/restored`, join(dir, 'restored')])
  const checked = await run('node', ['scripts/verify-backup.mjs', join(dir, 'restored/fixture/data')])
  if (checked.code) throw new Error(checked.stderr)
  await docker(['exec', name, 'psql', '-U', 'keycloak', '-d', 'keycloak', '-c', 'DROP TABLE fixture;'])
  await streamCommand(['exec', '-i', name, 'pg_restore', '-U', 'keycloak', '-d', 'keycloak', '--exit-on-error'], join(dir, 'restored/fixture/postgres.dump'))
  const result = await docker(['exec', name, 'psql', '-U', 'keycloak', '-d', 'keycloak', '-Atc', 'SELECT value FROM fixture;'])
  if (result.trim() !== 'restored') throw new Error('Database restore mismatch')
  console.log('Encrypted backup, repository integrity, restored JSON/Git and actual PostgreSQL restore passed.')
} finally { await run('docker', ['rm', '-f', name, files]); await run('docker', ['volume', 'rm', files]); await promisify(rm)(dir, { recursive: true, force: true }) }
