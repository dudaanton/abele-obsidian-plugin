// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed v2 input pin', () => {
  it('uses the exact streaming revision and its canonical v2 engine payload', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('f8ab871144f2b67135489de055f4e5f3b7315483')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('f8ab871144f2')
    expect(provenance.packages['@abele/sync-core'].files['dist/v2Client.js']).toBe(
      '110c88b19bff31f40870cbb6ea217a78b1c9f0a8c2a45b9046857bb0a9430829'
    )
  })
})
