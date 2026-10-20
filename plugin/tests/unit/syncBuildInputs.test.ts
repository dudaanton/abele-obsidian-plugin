// @vitest-environment node
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { verifySyncFixture } from '../../scripts/sync-server-fixture.mjs'
import { verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'
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
    expect(verifySyncSdkInputs(plugin).version).toBe('0.1.1')
  })

  it('rejects a deliberately mismatched npm package integrity', () => {
    isolated((root) => {
      for (const file of ['package.json', 'package-lock.json'])
        cpSync(resolve(plugin, file), resolve(root, file))
      const file = resolve(root, 'package-lock.json'),
        value = JSON.parse(readFileSync(file, 'utf8'))
      value.packages['node_modules/@abele/sync-sdk'].integrity = 'sha512-invalid'
      writeFileSync(file, JSON.stringify(value))
      expect(() => verifySyncSdkInputs(root)).toThrow(/integrity/i)
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
  it('pins the shared SDK to an exact registry version instead of mutable sibling code', () => {
    expect(manifest.dependencies['@abele/sync-sdk']).toBe('0.1.1')
    for (const name of ['@abele/sync-core', '@abele/sync-protocol', '@abele/notes'])
      expect(manifest.dependencies[name]).toBeUndefined()
  })
})
