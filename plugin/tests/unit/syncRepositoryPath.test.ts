// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { locateSyncRepository } from '../../scripts/sync-repository.mjs'

const temporary: string[] = []
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
})
function home() {
  const root = mkdtempSync(join(tmpdir(), 'sample-server-location-'))
  temporary.push(root)
  return root
}
function checkout(path: string) {
  mkdirSync(join(path, 'packages/server'), { recursive: true })
  writeFileSync(join(path, 'packages/server/package.json'), '{}')
  writeFileSync(join(path, 'package-lock.json'), '{}')
  return path
}

it('uses the documented home default independently of worktree depth and Git metadata', () => {
  const root = home(),
    expected = checkout(join(root, 'projects/abele-sync'))
  expect(locateSyncRepository({ home: root, env: {} })).toBe(expected)
})
it('prefers an explicit repository environment variable over the home default', () => {
  const root = home(),
    expected = checkout(join(root, 'checkouts/deep/server'))
  checkout(join(root, 'projects/abele-sync'))
  expect(locateSyncRepository({ home: root, env: { ABELE_SYNC_REPOSITORY: expected } })).toBe(
    expected
  )
})
it('fails clearly when the default server checkout is missing', () => {
  expect(() => locateSyncRepository({ home: home(), env: {} })).toThrow(
    /ABELE_SYNC_REPOSITORY.*server checkout/
  )
})
it('does not silently replace an explicitly missing server checkout', () => {
  const root = home()
  checkout(join(root, 'projects/abele-sync'))
  expect(() =>
    locateSyncRepository({ home: root, env: { ABELE_SYNC_REPOSITORY: join(root, 'missing') } })
  ).toThrow(/ABELE_SYNC_REPOSITORY/)
})
