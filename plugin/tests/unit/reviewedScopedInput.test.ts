// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SDK_INPUT, verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'
describe('reviewed v2 SDK input pin', () => {
  it('uses the exact integration archive and its canonical v2 engine payload', () => {
    expect(SDK_INPUT.version).toBe('0.3.5-pre.1')
    expect(verifySyncSdkInputs().version).toBe(SDK_INPUT.version)
    expect(SDK_INPUT.files['dist/internal/core/v2Client.js']).toBe(
      'f401886ce0afb88bd022e4bda2bfb5620db35e3842975d4a59b7f3f105afb8da'
    )
  })
})
