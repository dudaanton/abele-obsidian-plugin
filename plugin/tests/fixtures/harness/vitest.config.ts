import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/fixtures/harness/pendingWrites.case.ts'],
    setupFiles: ['tests/setup/pendingWrites.ts'],
  },
})
