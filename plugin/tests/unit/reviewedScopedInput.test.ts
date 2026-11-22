// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SDK_INPUT, verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'
describe('reviewed v2 SDK input pin', () => {
  it('uses the exact integration archive and its canonical v2 engine payload', () => {
    expect(SDK_INPUT.version).toBe('0.3.18-scan.5')
    expect(verifySyncSdkInputs().version).toBe(SDK_INPUT.version)
    expect(SDK_INPUT.files['dist/internal/core/v2Client.js']).toBe(
      'b69f71725c5d49dd9e936423a80d5db870a645b5caac05f25af690c65a8f910f'
    )
  })
})
