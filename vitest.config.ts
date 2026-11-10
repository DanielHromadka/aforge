import { configDefaults, defineConfig } from 'vitest/config'

// data/ holds the generated applications, whose Playwright specs are not ours to run.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, 'data/**'] } })
