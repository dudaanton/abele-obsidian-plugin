// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed scoped input pin', () => {
  it('uses only the exact reviewed committed scoped push correction revision', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('ac0df5090f7e754cda76296fbf3c8081d1076115')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('ac0df5090f7e')
  })
})
