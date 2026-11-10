import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { c } from 'tar'
import { afterEach, expect, it } from 'vitest'
import { applyJobFiles, extractJobFiles } from './job-files.js'
let dir: string
const setup = async () => { dir = await mkdtemp(join(tmpdir(), 'reactor-job-export-')); await mkdir(join(dir, 'source')); await mkdir(join(dir, 'target')); return { source: join(dir, 'source'), target: join(dir, 'target'), archive: join(dir, 'out.tar') } }
afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }) })
it('applies validated output including deletions without touching Git metadata or dependencies', async () => {
  const { source, target, archive } = await setup()
  await writeFile(join(source, 'added.txt'), 'new')
  await writeFile(join(target, 'deleted.txt'), 'old')
  await mkdir(join(target, '.git')); await writeFile(join(target, '.git/config'), 'keep')
  await mkdir(join(target, 'node_modules')); await writeFile(join(target, 'node_modules/keep'), 'keep')
  await c({ cwd: source, file: archive }, ['added.txt'])
  await extractJobFiles(archive, join(dir, 'extracted'))
  await applyJobFiles(join(dir, 'extracted'), target)
  expect(await readFile(join(target, 'added.txt'), 'utf8')).toBe('new')
  await expect(readFile(join(target, 'deleted.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await readFile(join(target, '.git/config'), 'utf8')).toBe('keep')
  expect(await readFile(join(target, 'node_modules/keep'), 'utf8')).toBe('keep')
})
it('rejects exported symlinks and excessive output before writing into the real workspace', async () => {
  const { source, archive } = await setup()
  await symlink('/etc/passwd', join(source, 'escape'))
  await c({ cwd: source, file: archive }, ['escape'])
  await expect(extractJobFiles(archive, join(dir, 'out'))).rejects.toThrow('odkazy')
  await writeFile(join(source, 'large.txt'), '123456')
  await c({ cwd: source, file: archive }, ['large.txt'])
  await expect(extractJobFiles(archive, join(dir, 'out2'), 3)).rejects.toThrow('limit')
})
