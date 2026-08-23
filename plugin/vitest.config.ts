import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

/**
 * Fast tier: unit + integration. No running Obsidian required, so this is what CI and the
 * pre-commit hook run. End-to-end tests live in `vitest.e2e.config.ts` and are opt-in.
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Production code imports the real plugin API; tests get the stand-in so that
      // `instanceof TFile` works against fixtures built by tests/helpers/fakeVault.ts.
      obsidian: path.resolve(__dirname, 'tests/mocks/obsidian.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    // Includes the complexity tier: those assertions describe how much work an algorithm may
    // do, they run against the in-memory fake vault in milliseconds, and they are the guard
    // that stops group resolution from silently going quadratic again.
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      // Component tier: Vue components mounted against happy-dom. It computes no layout, so
      // these assert what reaches the DOM and in what order, never how it looks.
      'tests/component/**/*.test.ts',
    ],
    reporters: 'default',
  },
})
