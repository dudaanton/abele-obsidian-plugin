// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { testSharingBuildPlugin, TEST_SHARING_MODULE } from '../../scripts/test-sharing-build.mjs'
import { assertNoTestingModules } from '../../scripts/production-test-guard.mjs'

const flags = [
  ['src/sync/sharing/folderSharing.ts', 'OWNER_SHARING_ENABLED'],
  ['src/sync/scoped/scopedJoin.ts', 'SCOPED_JOIN_ENABLED'],
  ['src/sync/scoped/scopedCreation.ts', 'SCOPED_CREATION_ENABLED'],
  ['src/sync/publication/fence.ts', 'PUBLICATION_ENABLED'],
]

describe('production sharing with isolated test activation', () => {
  it('enables every sharing surface in production without loading the test marker', () => {
    for (const [file, flag] of flags) {
      const source = readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
      expect(source).toContain(`export const ${flag} = true`)
      expect(testSharingBuildPlugin('production').transform(source, '/sample/plugin/' + file)).toBeNull()
      expect(testSharingBuildPlugin('development').transform(source, '/sample/plugin/' + file)).toBeNull()
      expect(testSharingBuildPlugin('sharing-test').transform(source, '/sample/plugin/' + file)).toContain(TEST_SHARING_MODULE)
    }
  })

  it('rejects a test-sharing module from the production graph even if minification removed its name', () => {
    expect(() =>
      assertNoTestingModules({
        main: { type: 'chunk', modules: { ['\0' + TEST_SHARING_MODULE]: { renderedLength: 1 } } },
      })
    ).toThrow(/sharing activation/)
  })

  it('rejects rendered test API modules while permitting ordinary sharing modules', () => {
    expect(() => assertNoTestingModules({
      main: { type: 'chunk', modules: { '/sample/src/testing/exposeTestApi.ts': { renderedLength: 1 } } },
    })).toThrow(/testing module/)
    expect(() => assertNoTestingModules({
      main: { type: 'chunk', modules: { '/sample/src/sync/sharing/folderSharing.ts': { renderedLength: 100 } } },
    })).not.toThrow()
  })

  it('refuses accidental production deactivation', () => {
    expect(() => testSharingBuildPlugin('production').transform(
      'export const PUBLICATION_ENABLED = false',
      '/sample/plugin/src/sync/publication/fence.ts'
    )).toThrow(/true/)
  })
})
