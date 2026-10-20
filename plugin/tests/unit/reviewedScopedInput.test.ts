// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SDK_INPUT, verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'
describe('reviewed v2 SDK input pin', () => {
  it('uses the exact npm release and its canonical v2 engine payload', () => {
    expect(verifySyncSdkInputs().version).toBe('0.1.1')
    expect(SDK_INPUT.files['dist/internal/core/v2Client.js']).toBe(
      'b999c85084bc70942dbdb43ddf7aa6581b30a88878070a7b6581b19174e09bc2'
    )
  })
})
