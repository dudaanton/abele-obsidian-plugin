// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed scoped input pin', () => {
  it('uses only the exact reviewed committed scoped push correction revision', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('3b82b27ef378b33a7edf1bced02332612960c4b2')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('3b82b27ef378')
  })
})
