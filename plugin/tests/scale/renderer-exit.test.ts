// @vitest-environment node
import { expect, it } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const diagnostic = require('./diagnostics.cjs')

it('persists only controlled renderer exit reason and code', () => {
  const receipt = diagnostic.rendererExitReceipt({ reason: 'crashed', exitCode: 6,
    message: 'Bearer sample-private-token', stack: '/private/sample.js',
    argv: ['sample-private-token'], stderr: 'sample-private-token' })
  expect(receipt).toEqual({ event: 'renderer-exit', reason: 'crashed', exitCode: 6 })
  expect(JSON.stringify(receipt)).not.toContain('sample-private-token')
})
it('does not persist arbitrary exit reasons or malformed exit codes', () => {
  expect(diagnostic.rendererExitReceipt({ reason: 'sample-private-token', exitCode: 'sample-private-token' }))
    .toEqual({ event: 'renderer-exit', reason: 'unknown', exitCode: null })
})
