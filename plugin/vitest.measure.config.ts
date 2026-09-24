import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Measurement tier — what the agent's tools cost in tokens, on a real vault.
 *
 * Not a test of right and wrong: it runs the tools over a vault read from disk and prints how
 * many tokens each result and a whole run cost, before and after compaction. It needs a vault,
 * named by `ABELE_MEASURE_VAULT` (and optionally a folder in it, `ABELE_MEASURE_FOLDER`), so it
 * stays out of the default tier.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      obsidian: path.resolve(__dirname, 'tests/measure/obsidianMock.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/measure/**/*.measure.test.ts'],
    testTimeout: 300_000,
    reporters: 'default',
  },
})
