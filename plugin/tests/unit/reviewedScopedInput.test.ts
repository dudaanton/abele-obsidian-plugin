// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SDK_INPUT, verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'
describe('reviewed v2 SDK input pin', () => {
  it('uses the exact npm release and its canonical v2 engine payload', () => {
    expect(SDK_INPUT.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(verifySyncSdkInputs().version).toBe(SDK_INPUT.version)
    expect(SDK_INPUT.files['dist/internal/core/v2Client.js']).toBe(
      '5cddcc4341a51c4effc9161eeae060511e2d3a5ed519d6c132ff22814ed26469'
    )
  })
})
