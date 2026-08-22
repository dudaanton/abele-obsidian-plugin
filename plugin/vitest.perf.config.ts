import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Complexity tier — assertions about how much work group resolution does.
 *
 * These run against the in-memory fake vault, so they are deterministic and need neither
 * Obsidian nor a generated vault on disk. They are kept out of the default tier because
 * they currently fail on purpose, describing the target complexity rather than the current
 * one. Merge this back into `vitest.config.ts` once the implementation satisfies them.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      obsidian: path.resolve(__dirname, 'tests/mocks/obsidian.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.perf.test.ts'],
    testTimeout: 120_000,
    reporters: 'default',
  },
})
