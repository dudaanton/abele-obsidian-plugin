// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { missingServerTests, serverTestFixtures } from '../../scripts/server-test-fixtures.mjs'
import { locateSyncFixture, selectServerTests } from '../../scripts/test-server.mjs'

const scratch = fileURLToPath(new URL('../../../.scratch/sync-inputs/', import.meta.url))
const temporary: string[] = []
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})
function fixtureCache() {
  mkdirSync(scratch, { recursive: true })
  const directory = mkdtempSync(join(scratch, 'server-fixture-test-'))
  temporary.push(directory)
  return directory
}
function archive(directory: string, name: string, commit: string) {
  const source = join(directory, 'fixture-' + name, 'source')
  const files = ['package-lock.json', 'packages/server/dist/index.js', 'packages/cli/dist/index.js']
  const checksum = createHash('sha256').update('sample').digest('hex')
  for (const file of files) {
    mkdirSync(join(source, file, '..'), { recursive: true })
    writeFileSync(join(source, file), 'sample')
  }
  writeFileSync(
    join(source, '.abele-sync-fixture.json'),
    JSON.stringify({
      commit,
      lockSha256: checksum,
      files: Object.fromEntries(files.slice(1).map((file) => [file, checksum])),
    })
  )
  return source
}

describe('server-backed fast-tier fixture gate', () => {
  it('registers only existing current fixture consumers', () => {
    for (const file of Object.values(serverTestFixtures).flat()) expect(existsSync(file)).toBe(true)
  })
  it('skips only the files that require an absent fixture', () => {
    const skipped = missingServerTests({})
    expect(skipped).toHaveLength(13)
    expect(skipped).toContain('tests/integration/interruptedMoveExchange.test.ts')
    expect(skipped).not.toContain('tests/integration/scopedPublicationPush.test.ts')
    expect(skipped).toContain('tests/integration/tokenEngineServer.test.ts')
    expect(skipped).toContain('tests/integration/externalRepresentationServer.test.ts')
    expect(skipped).toContain('tests/integration/productionSharingBuild.test.ts')
    expect(skipped).toContain('tests/integration/syncService.test.ts')
    expect(skipped).not.toContain('tests/unit/syncBuildInputs.test.ts')
    expect(skipped).toContain('tests/unit/syncLiveServer.test.ts')
    expect(skipped.filter((file: string) => !file.startsWith('tests/integration/'))).toEqual([
      'tests/unit/syncLiveServer.test.ts',
    ])
  })

  it('runs every current token fixture when its explicit variable is set', () => {
    expect(missingServerTests({ ABELE_SYNC_DIR: '/sample/fixture' })).toEqual([])
    const file = 'tests/integration/tokenEngineServer.test.ts'
    expect(selectServerTests(['--tests', file])).toEqual({
      repository: undefined,
      files: [file],
      variables: ['ABELE_SYNC_DIR'],
    })
    expect(() => selectServerTests(['--tests', 'tests/e2e/sync.e2e.test.ts'])).toThrow(/registered/)
  })

  it('locates only a matching checksum-verified prepared archive', () => {
    const directory = fixtureCache()
    archive(directory, 'old', 'a'.repeat(40))
    const source = archive(directory, 'pinned', 'b'.repeat(40))
    expect(locateSyncFixture(directory, 'b'.repeat(40))).toBe(source)
  })

  it('requires preparation when no matching archive is available', () => {
    const directory = fixtureCache()
    expect(locateSyncFixture(join(directory, 'absent'), 'b'.repeat(40))).toBeUndefined()
    archive(directory, 'old', 'a'.repeat(40))
    expect(locateSyncFixture(directory, 'b'.repeat(40))).toBeUndefined()
  })

  it('never falls back from a tampered matching archive', () => {
    const directory = fixtureCache()
    const source = archive(directory, 'pinned', 'b'.repeat(40))
    writeFileSync(join(source, 'packages/server/dist/index.js'), 'changed')
    expect(() => locateSyncFixture(directory, 'b'.repeat(40))).toThrow(/input changed/)
  })
})
