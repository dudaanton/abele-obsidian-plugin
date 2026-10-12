// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed v2 input pin', () => {
  it('uses the exact streaming revision and its canonical v2 engine payload', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('6a667ea07d9b389d6cfea9ca16761e083fad9153')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('6a667ea07d9b')
    expect(provenance.packages['@abele/sync-core'].files['dist/v2Client.js']).toBe(
      '110c88b19bff31f40870cbb6ea217a78b1c9f0a8c2a45b9046857bb0a9430829'
    )
  })
})
