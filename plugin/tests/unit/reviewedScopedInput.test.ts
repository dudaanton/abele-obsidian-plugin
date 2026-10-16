// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed v2 input pin', () => {
  it('uses the exact streaming revision and its canonical v2 engine payload', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('4b57c445777f32230709e743df6d613ab27ece29')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('4b57c445777f')
    expect(provenance.packages['@abele/sync-core'].files['dist/v2Client.js']).toBe(
      '272e4505bb396593ba9bac0cd154b7a8e3254057657b5be585674366a82330a6'
    )
  })
})
