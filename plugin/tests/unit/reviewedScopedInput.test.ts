// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SDK_INPUT, verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'
describe('reviewed v2 SDK input pin', () => {
  it('uses the exact integration archive and its canonical v2 engine payload', () => {
    expect(SDK_INPUT.version).toBe('0.3.6')
    expect(verifySyncSdkInputs().version).toBe(SDK_INPUT.version)
    expect(SDK_INPUT.files['dist/internal/core/v2Client.js']).toBe(
      'fa2220ea531c731dac4230a0106ceaa1857aaa15ee5a9c5ab7b64c5f56491626'
    )
  })
})
