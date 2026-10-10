// @vitest-environment node
import { describe, it, expect } from 'vitest'
const TEST_SHARING_MODULE = 'virtual:abele-test-sharing'
import { assertNoTestingModules } from '../../scripts/production-test-guard.mjs'

describe('production sharing with isolated test activation', () => {
  it('rejects a test-sharing module from the production graph even if minification removed its name', () => {
    expect(() =>
      assertNoTestingModules({
        main: { type: 'chunk', modules: { ['\0' + TEST_SHARING_MODULE]: { renderedLength: 1 } } },
      })
    ).toThrow(/sharing activation/)
  })

  it('rejects rendered test API modules while permitting ordinary sharing modules', () => {
    expect(() =>
      assertNoTestingModules({
        main: {
          type: 'chunk',
          modules: { '/sample/src/testing/exposeTestApi.ts': { renderedLength: 1 } },
        },
      })
    ).toThrow(/testing module/)
    expect(() =>
      assertNoTestingModules({
        main: {
          type: 'chunk',
          modules: { '/sample/src/sync/sharing/folderSharing.ts': { renderedLength: 100 } },
        },
      })
    ).not.toThrow()
  })
})
