import lockfile from 'proper-lockfile'
import { join } from 'node:path'
import { DATA_DIR } from './project-locations.js'
let release: (() => Promise<void>) | undefined
export const acquireStore = async () => {
  release = await lockfile.lock(DATA_DIR, { realpath: true, stale: 60_000, update: 10_000, lockfilePath: join(DATA_DIR, '.server.lock'), onCompromised: (error) => { console.error('Data lock lost:', error.message); process.exit(1) } })
}
export const releaseStore = async () => { const unlock = release; release = undefined; await unlock?.() }
