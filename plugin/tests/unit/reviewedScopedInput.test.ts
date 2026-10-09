// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed scoped input pin', () => {
  it('uses the exact canonical revision without changing the reviewed scoped push payload', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('19d35b116a4ac6c062b50154b2fd33626e2ef012')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('19d35b116a4a')
    expect(provenance.packages['@abele/sync-core'].files['dist/scopedPush.js']).toBe(
      '9e9c7888d8da1f7c96d8e9b1401ace2b8829af4899c948fd085364622e651983'
    )
  })
})
