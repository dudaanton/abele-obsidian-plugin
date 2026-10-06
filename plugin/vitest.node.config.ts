import { defineConfig } from 'vitest/config'
import path from 'node:path'

/** Real daemon integration is explicit: provide its built CLI, never substitute a mock server. */
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/node/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
