import { defineConfig } from 'vitest/config'

/**
 * Bundle size tier: builds the production `main.js` and holds it to a committed budget
 * (`tests/size/budget.json`). A separate tier because it runs a whole build (~6 s) — too slow
 * for the pre-commit hook, cheap enough for CI. See docs/Testing.md.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/size/**/*.size.test.ts'],
    testTimeout: 180_000,
    reporters: 'default',
  },
})
