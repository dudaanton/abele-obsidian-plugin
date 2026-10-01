// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
)

describe('reproducible sync build inputs', () => {
  it('routes every server-backed seed helper through the explicit pinned fixture', () => {
    for (const name of [
      'syncJoin',
      'syncOwnSettings',
      'syncService',
      'syncHeldDeletes',
      'syncStagedSettings',
    ]) {
      const source = readFileSync(
        fileURLToPath(new URL(`../integration/${name}.test.ts`, import.meta.url)),
        'utf8'
      )
      expect(source).not.toContain('../../../../abele-sync/')
      expect(source).toContain("from '@abele/sync-test-seed'")
    }
  })
  it('does not run a mutation of a sibling checkout before production builds', () => {
    expect(JSON.stringify(manifest.scripts)).not.toContain('../../abele-sync')
  })
  it('pins both packaged inputs instead of resolving a mutable sibling dist', () => {
    for (const name of ['@abele/sync-core', '@abele/sync-protocol']) {
      expect(manifest.dependencies[name]).toMatch(/^file:vendor\/sync\/.*\.tgz$/)
    }
  })
})
