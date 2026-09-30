import { defineConfig } from 'vitest/config'
export default defineConfig({ test: {
  include: ['tests/fixtures/harness/zeroTests.case.ts'],
  reporters: ['default', './tests/e2e/helpers/requireTests.ts'],
} })
