import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { syncPlacementPlugin } from './scripts/sync-placement.mjs'

/** Real daemon integration is explicit: provide its built CLI, never substitute a mock server. */
export default defineConfig({
  plugins: [syncPlacementPlugin()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    server: { deps: { inline: [/@abele\/sync-core/] } },
    environment: 'node',
    include: ['tests/node/**/*.test.ts'],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
})
