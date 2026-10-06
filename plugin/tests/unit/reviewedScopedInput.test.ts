// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed scoped input pin', () => {
  it('uses only the exact reviewed committed scoped push correction revision', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('5cd9207bdf676cf19097b374c0a623e7909aa25a')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('5cd9207bdf67')
  })
})
