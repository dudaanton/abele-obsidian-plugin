// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
describe('reviewed v2 input pin', () => {
  it('uses the exact canonical revision without changing the reviewed v2 engine payload', () => {
    const provenance = JSON.parse(
      readFileSync(new URL('../../vendor/sync/provenance.json', import.meta.url), 'utf8')
    )
    expect(provenance.commit).toBe('cf01a4abb764464a3bc4ab9ab3cb3d5bf1f0d62c')
    for (const pkg of Object.values(provenance.packages) as any[])
      expect(pkg.archive).toContain('cf01a4abb764')
    expect(provenance.packages['@abele/sync-core'].files['dist/v2Client.js']).toBe(
      'bde854523badcc222792dfe252b586a94322a1a129a89ada0340ff599d37e365'
    )
  })
})
