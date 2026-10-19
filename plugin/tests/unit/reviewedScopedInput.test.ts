// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed v2 input pin', () => {
  it('uses the exact streaming revision and its canonical v2 engine payload', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('b0ed82060937d210f14838456d51fbe3fc055188')
    for (const name of ['@abele/sync-core', '@abele/sync-protocol']) {
      expect(provenance.packages[name].version).toBe('0.4.0')
      expect(provenance.packages[name].archive).toContain('-0.4.0.tgz')
    }
    expect(provenance.packages['@abele/sync-core'].files['dist/v2Client.js']).toBe(
      '2ae7c9cbb07f92ffb4d2a2e75d57214c23dc651fb380ef2209e4fb53b2506d96'
    )
  })
})
