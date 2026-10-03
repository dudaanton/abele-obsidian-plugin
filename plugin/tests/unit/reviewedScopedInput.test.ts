// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed scoped input pin', () => {
  it('uses only the exact reviewed committed scoped push correction revision', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('b5357cff918028e1e58b443ccc22eed0093eb689')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('b5357cff9180')
  })
})
