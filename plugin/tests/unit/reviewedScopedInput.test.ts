// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SDK_INPUT, verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'
describe('reviewed v2 SDK input pin', () => {
  it('uses the exact integration archive and its canonical v2 engine payload', () => {
    expect(SDK_INPUT.version).toBe('0.3.17-scan.3')
    expect(verifySyncSdkInputs().version).toBe(SDK_INPUT.version)
    expect(SDK_INPUT.files['dist/internal/core/v2Client.js']).toBe(
      '6074ad681e4ee06a67a5939de5da7b58db669c45b5b38c3743e85c597ab973b4'
    )
  })
})
