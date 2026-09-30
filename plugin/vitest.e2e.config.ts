import { configDefaults, defineConfig } from 'vitest/config'
import path from 'path'
import { readdirSync, readFileSync } from 'fs'
import { declaredTargets } from './tests/e2e/helpers/target'

/**
 * Which files this run takes: a file declares the devices it runs on with `targets(...)` (see
 * `tests/e2e/helpers/target.ts`), no declaration meaning the desktop. `E2E_TARGET=phone` runs
 * on a real phone and takes only the files that name it.
 */
const target = process.env.E2E_TARGET === 'phone' ? 'phone' : 'desktop'
const e2eDir = path.resolve(__dirname, 'tests/e2e')
const notForThisTarget = readdirSync(e2eDir)
  .filter((f) => f.endsWith('.test.ts'))
  .filter((f) => !declaredTargets(readFileSync(path.join(e2eDir, f), 'utf8')).includes(target))
  .map((f) => `tests/e2e/${f}`)

/**
 * End-to-end tier: drives the actually-running Obsidian through its CLI.
 *
 * These run single-threaded on purpose. There is exactly one Obsidian instance on the
 * machine and tests mutate its vault and plugin state, so concurrent files would race.
 * Timeouts are generous because the behaviour under test includes multi-second
 * main-thread stalls — a tight timeout would mask the very thing being measured.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...notForThisTarget],
    setupFiles: ['tests/e2e/helpers/liveWindow.ts'],
    globalSetup: ['tests/e2e/helpers/globalSetup.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    reporters: ['default', './tests/e2e/helpers/requireTests.ts'],
  },
})
