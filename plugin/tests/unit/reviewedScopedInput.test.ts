// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed v2 input pin', () => {
  it('uses the exact canonical revision without changing the reviewed v2 engine payload', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('c5d4ccbf83fc4b2812f8cc131d1918851546295e')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('c5d4ccbf83fc')
    expect(provenance.packages['@abele/sync-core'].files['dist/v2Client.js']).toBe(
      'c852e1f7e7913924d3306830c47c81247ff69cd1418fef862acafa288331c685'
    )
  })
})
