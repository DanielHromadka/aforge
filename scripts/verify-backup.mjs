import { readdir, readFile, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
const root = resolve(process.argv[2] ?? '')
if (!process.argv[2]) throw new Error('Supply restored data directory')
let count = 0
const walk = async (dir) => {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, item.name)
    if (item.isSymbolicLink()) continue
    if (item.isDirectory()) {
      if (item.name === '.git') {
        const result = spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', 'fsck', '--full'], { cwd: dir, encoding: 'utf8' })
        if (result.status !== 0) throw new Error(`Invalid Git repository: ${dir}`)
      } else if (!['node_modules', 'dist', 'bin', 'obj'].includes(item.name)) await walk(file)
    } else if (item.name.endsWith('.json') && !file.includes('/workspace/') && !file.includes('/repos/')) {
      if ((await lstat(file)).size > 100 * 1024 ** 2) throw new Error(`Oversized model: ${file}`)
      JSON.parse(await readFile(file, 'utf8')); count++
    }
  }
}
await walk(root)
console.log(`Verified ${count} stored JSON files and all workspace Git repositories.`)
