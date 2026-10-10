// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed v2 input pin', () => {
  it('uses the exact canonical revision without changing the reviewed v2 engine payload', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('664759f8ab307c74804868bbe5bb8e3e3182d0e0')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('664759f8ab30')
    expect(provenance.packages['@abele/sync-core'].files['dist/v2Client.js']).toBe(
      '6ea2261be494055521644de1598c483e2090a291260998295430cf2c6f4f82b6'
    )
  })
})
