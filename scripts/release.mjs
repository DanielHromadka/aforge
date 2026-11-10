import { spawnSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
const run = (cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status ?? 1) }
for (const task of ['typecheck', 'test', 'build']) run('npm', ['run', task])
const dir = resolve('.releases'); await mkdir(dir, { recursive: true })
const version = new Date().toISOString().replace(/[-:.TZ]/g, '')
await writeFile(join(dir, 'release.json'), JSON.stringify({ version, createdAt: new Date().toISOString(), nodeMajor: 22 }) + '\n')
const file = `reactor-${version}.tar.gz`
run('tar', ['-czf', join(dir, file), '--exclude=node_modules', '--exclude=data', '--exclude=*.test.ts', '--exclude=*.test.tsx', '--exclude=.env', '--exclude=.env.*', '--exclude=*.env', '--exclude=*.pem', '--exclude=*.key', '.dockerignore', 'package.json', 'package-lock.json', 'tsconfig.base.json', 'packages', 'apps', 'runtime', 'deploy', 'scripts', 'README.md', '-C', dir, 'release.json'])
await writeFile(join(dir, `${file}.sha256`), `${createHash('sha256').update(await readFile(join(dir, file))).digest('hex')}  ${file}\n`)
console.log(`Release: ${join(dir, file)}`)
