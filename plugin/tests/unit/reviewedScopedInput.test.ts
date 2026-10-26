// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SDK_INPUT, verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'
describe('reviewed v2 SDK input pin', () => {
  it('uses the exact integration archive and its canonical v2 engine payload', () => {
    expect(SDK_INPUT.version).toBe('0.3.7')
    expect(verifySyncSdkInputs().version).toBe(SDK_INPUT.version)
    expect(SDK_INPUT.files['dist/internal/core/v2Client.js']).toBe(
      'a9f63218060c560bef95e4859f183f9bdede7205d6bf0cebac463cc682b72cb2'
    )
  })
})
