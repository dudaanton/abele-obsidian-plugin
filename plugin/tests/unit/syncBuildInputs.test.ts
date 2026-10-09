// @vitest-environment node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { verifySyncFixture, verifySyncInputs } from '../../scripts/verify-sync-inputs.mjs'
import { SERVER_TEST_COMMIT } from '../../scripts/server-test-fixtures.mjs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8')
)

describe('reproducible sync build inputs', () => {
  const plugin = fileURLToPath(new URL('../..', import.meta.url))
  const scratch = resolve(plugin, '../.scratch')
  const isolated = (fn: (root: string) => void): void => {
    mkdirSync(scratch, { recursive: true })
    const root = mkdtempSync(resolve(scratch, 'sync-input-test-'))
    try {
      fn(root)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it('accepts the selected archive, lockfile and installed payload', () => {
    expect(verifySyncInputs(plugin).commit).toBe('75b84b5d3e83e119e9624b32a331e1827986342d')
  })

  it('rejects a deliberately mismatched archive and provenance revision', () => {
    isolated((root) => {
      for (const path of ['package.json', 'package-lock.json', 'vendor/sync'])
        cpSync(resolve(plugin, path), resolve(root, path), { recursive: true })
      for (const name of ['sync-core', 'sync-protocol'])
        cpSync(
          resolve(plugin, 'node_modules/@abele', name),
          resolve(root, 'node_modules/@abele', name),
          { recursive: true }
        )
      const path = resolve(root, 'vendor/sync/provenance.json')
      const provenance = JSON.parse(readFileSync(path, 'utf8'))
      provenance.commit = 'f927e62bb41817cd3cf0180e80f989e8c166ff1d'
      writeFileSync(path, JSON.stringify(provenance))
      expect(() => verifySyncInputs(root)).toThrow(/revision/i)
      provenance.commit = '75b84b5d3e83e119e9624b32a331e1827986342d'
      writeFileSync(path, JSON.stringify(provenance))
      writeFileSync(
        resolve(root, 'vendor/sync', provenance.packages['@abele/sync-core'].archive),
        'mismatched archive'
      )
      expect(() => verifySyncInputs(root)).toThrow(/checksum mismatch/i)
    })
  })

  it('accepts the independently pinned fixture and rejects a different revision or changed payload', () => {
    isolated((root) => {
      const files = {
        'package-lock.json': '{}',
        'packages/server/dist/index.js': 'export {}',
        'packages/cli/dist/index.js': 'export {}',
      }
      for (const [path, bytes] of Object.entries(files)) {
        mkdirSync(resolve(root, path, '..'), { recursive: true })
        writeFileSync(resolve(root, path), bytes)
      }
      const hash = (bytes: string): string => createHash('sha256').update(bytes).digest('hex')
      const fixture = {
        commit: SERVER_TEST_COMMIT,
        lockSha256: hash(files['package-lock.json']),
        files: Object.fromEntries(
          Object.entries(files).map(([path, bytes]) => [path, hash(bytes)])
        ),
      }
      const marker = resolve(root, '.abele-sync-fixture.json')
      writeFileSync(marker, JSON.stringify(fixture))
      expect(verifySyncFixture(root)).toBe(root)
      fixture.commit = '80bc7c666ac54cc186696ebdaaccd2d9e7a735ba'
      writeFileSync(marker, JSON.stringify(fixture))
      expect(() => verifySyncFixture(root)).toThrow(/revision/i)
      fixture.commit = SERVER_TEST_COMMIT
      writeFileSync(marker, JSON.stringify(fixture))
      writeFileSync(resolve(root, 'packages/server/dist/index.js'), 'changed')
      expect(() => verifySyncFixture(root)).toThrow(/input changed/i)
    })
  })
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
