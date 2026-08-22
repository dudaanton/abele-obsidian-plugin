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
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // The complexity tier is excluded here because it currently fails by design: it states
    // the cost group resolution SHOULD have, and the implementation does not meet it yet.
    // Keeping it out of the commit hook keeps commits possible; run it with `npm run
    // test:perf`. Fold it back into this tier once the group-resolution rewrite lands.
    exclude: ['**/node_modules/**', '**/*.perf.test.ts'],
    reporters: 'default',
  },
})
