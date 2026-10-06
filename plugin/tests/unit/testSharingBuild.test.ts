// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { testSharingBuildPlugin, TEST_SHARING_MODULE } from '../../scripts/test-sharing-build.mjs'
import { assertNoTestingModules } from '../../scripts/production-test-guard.mjs'
describe('explicit build-time sharing activation', () => {
  it('leaves production source flags false and changes only the dedicated test build', () => {
    for (const [file, flag] of [
      ['src/sync/sharing/folderSharing.ts', 'OWNER_SHARING_ENABLED'],
      ['src/sync/publication/fence.ts', 'PUBLICATION_ENABLED'],
    ]) {
      const source = readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
      expect(source).toContain(`export const ${flag} = false`)
      expect(
        testSharingBuildPlugin('production').transform(source, '/sample/plugin/' + file)
      ).toBeNull()
      expect(
        testSharingBuildPlugin('development').transform(source, '/sample/plugin/' + file)
      ).toBeNull()
      expect(
        testSharingBuildPlugin('sharing-test').transform(source, '/sample/plugin/' + file)
      ).toContain(TEST_SHARING_MODULE)
    }
  })
  it('rejects a test-sharing module from the production graph even if minification removed its name', () => {
    expect(() =>
      assertNoTestingModules({
        main: { type: 'chunk', modules: { ['\0' + TEST_SHARING_MODULE]: { renderedLength: 1 } } },
      })
    ).toThrow(/sharing activation/)
  })
  it('refuses production source activation instead of weakening its check', () => {
    expect(() =>
      testSharingBuildPlugin('production').transform(
        'export const PUBLICATION_ENABLED = true',
        '/sample/plugin/src/sync/publication/fence.ts'
      )
    ).toThrow(/false/)
  })
})
