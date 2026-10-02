// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { assertNoTestingModules } from '../../scripts/production-test-guard.mjs'
describe('production rendered-module fence', () => {
  it('rejects any retained testing module even if its exported API name was minified', () => {
    expect(() =>
      assertNoTestingModules({
        main: {
          type: 'chunk',
          modules: { '/sample/plugin/src/testing/fixtureContext.ts': { renderedLength: 1 } },
        },
      })
    ).toThrow(/testing module/)
  })
  it('permits completely tree-shaken testing modules and unrelated modules', () => {
    expect(() =>
      assertNoTestingModules({
        main: {
          type: 'chunk',
          modules: {
            '/sample/plugin/src/testing/fixtureContext.ts': { renderedLength: 0 },
            '/sample/plugin/src/scripting/trust/scriptContextHold.ts': { renderedLength: 100 },
          },
        },
      })
    ).not.toThrow()
  })
})
