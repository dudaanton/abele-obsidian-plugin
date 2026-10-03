// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed scoped input pin', () => {
  it('uses only the exact reviewed committed scoped push correction revision', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('c3cec3ff2d0831d10fa13fc76338c4c78ed40be3')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('c3cec3ff2d08')
  })
})
