// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed scoped input pin', () => {
  it('uses only the exact reviewed committed scoped pull revision', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('eb4844854b0a240c074fdae509ebce083ae03727')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('eb4844854b0a')
  })
})
