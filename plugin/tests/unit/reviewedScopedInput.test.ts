// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed scoped input pin', () => {
  it('uses the exact canonical revision without changing the reviewed scoped push payload', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('70b178a19ff66aad73ae2cc92e3508cca8e25c42')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('70b178a19ff6')
    expect(provenance.packages['@abele/sync-core'].files['dist/scopedPush.js']).toBe(
      '9e9c7888d8da1f7c96d8e9b1401ace2b8829af4899c948fd085364622e651983'
    )
  })
})
