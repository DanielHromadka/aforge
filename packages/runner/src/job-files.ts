import { readdir, lstat, mkdir, copyFile, chmod, rm, rmdir } from 'node:fs/promises'
import { join, resolve, relative, sep, dirname } from 'node:path'
import { x, t } from 'tar'

const omitted = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist'])
const pathInside = (root: string, name: string) => {
  const full = resolve(root, name)
  if (!full.startsWith(root + sep) || relative(root, full).split(sep).some((part) => omitted.has(part))) throw new Error('Neplatná cesta výstupu agenta.')
  return full
}
export const extractJobFiles = async (archive: string, target: string, maxBytes = 512 * 1024 ** 2) => {
  await mkdir(target, { recursive: true })
  let count = 0, total = 0
  let invalid: Error | undefined
  await t({ file: archive, strict: true, onReadEntry: (entry) => {
    try {
      if (entry.path === './' || entry.path === '.') return
      pathInside(target, entry.path)
      if (!['File', 'Directory'].includes(entry.type)) throw new Error('Výstup agenta nesmí obsahovat odkazy ani speciální soubory.')
      total += entry.size; count++
      if (total > maxBytes || count > 50_000) throw new Error('Výstup agenta překročil limit velikosti nebo počtu souborů.')
    } catch (e) { invalid = e as Error }
  } })
  if (invalid) throw invalid
  await x({ file: archive, cwd: target, strict: true, preservePaths: false, noChmod: true, filter: (_path, entry) => { entry.mode = (entry.mode ?? 0o644) & 0o777; return true } })

}
const tree = async (root: string, rel = ''): Promise<{ files: string[]; dirs: string[] }> => {
  const files: string[] = [], dirs: string[] = []
  for (const item of await readdir(join(root, rel), { withFileTypes: true })) {
    if (omitted.has(item.name)) continue
    const path = join(rel, item.name)
    if (item.isSymbolicLink()) throw new Error('Pracovní strom obsahuje symbolický odkaz. Odstraňte ho před spuštěním agenta.')
    if (item.isDirectory()) { dirs.push(path); const sub = await tree(root, path); files.push(...sub.files); dirs.push(...sub.dirs) }
    else if (item.isFile()) files.push(path)
  }
  return { files, dirs }
}
export const validateJobWorkspace = async (root: string) => { await tree(root) }

/** Copy only validated regular files; no job ever gets a writable host bind mount. */
export const applyJobFiles = async (source: string, target: string) => {
  const before = await tree(target), after = await tree(source)
  const kept = new Set(after.files)
  for (const path of before.files) if (!kept.has(path)) await rm(pathInside(target, path))
  for (const path of before.dirs.sort((a, b) => b.length - a.length)) await rmdir(pathInside(target, path)).catch(() => {})
  for (const path of after.files) {
    const destination = pathInside(target, path)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(pathInside(source, path), destination)
    const mode = (await lstat(pathInside(source, path))).mode & 0o111 ? 0o755 : 0o644
    await chmod(destination, mode)
  }
}
