// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
describe('task63 inspection is readonly production-excluded source', () => {
  it('covers every fenced screen with synthetic data and no enabled mutation flag', () => {
    const code = readFileSync(
      new URL('../../src/testing/FencedScreenFixture.vue', import.meta.url),
      'utf8'
    )
    for (const name of [
      'folder',
      'group',
      'initial-batch',
      'invitation',
      'creation',
      'publication',
      'unshare',
      'script-approval',
      'plugin-code',
      'personal-join',
    ])
      expect(code).toMatch(new RegExp('screen\\s*===\\s*' + '[\'\\"]' + name + '[\'\\"]'))
    expect(code).not.toContain(':enabled="true"')
    expect(code).toContain(':read-only="true"')
    expect(code).toContain(':busy="true"')
  })
})
