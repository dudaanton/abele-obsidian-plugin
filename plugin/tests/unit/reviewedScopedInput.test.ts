// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SDK_INPUT, verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'
describe('reviewed v2 SDK input pin', () => {
  it('uses the exact npm release and its canonical v2 engine payload', () => {
    expect(SDK_INPUT.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(verifySyncSdkInputs().version).toBe(SDK_INPUT.version)
    expect(SDK_INPUT.files['dist/internal/core/v2Client.js']).toBe(
      '3ef611194e8167e25afeda9cf0f22b7ebcf1cbe18b40112ca959e6f14ba0f1d8'
    )
  })
})
