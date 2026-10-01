// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
)

describe('reproducible sync build inputs', () => {
  it('does not run a mutation of a sibling checkout before production builds', () => {
    expect(JSON.stringify(manifest.scripts)).not.toContain('../../abele-sync')
  })
  it('pins both packaged inputs instead of resolving a mutable sibling dist', () => {
    for (const name of ['@abele/sync-core', '@abele/sync-protocol']) {
      expect(manifest.dependencies[name]).toMatch(/^file:vendor\/sync\/.*\.tgz$/)
    }
  })
})
