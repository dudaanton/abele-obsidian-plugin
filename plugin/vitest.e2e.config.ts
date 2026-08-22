import { defineConfig } from 'vitest/config'
import path from 'path'

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
    testTimeout: 180_000,
    hookTimeout: 180_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    reporters: 'default',
  },
})
