// Acquire the single-writer lease before any module can recover jobs or persist hub/auth state.
import { acquireStore, releaseStore } from './store-lock.js'
import { validateProduction } from './config.js'
validateProduction()
await acquireStore()
export const app = await import('./application.js').then((module) => module.app).catch(async (error) => { await releaseStore(); throw error })
