// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { checkBuild, checkVersions } from '../../scripts/check-release.mjs'

describe('release asset validation', () => {
  it('accepts the raw version produced by release.sh', () => {
    expect(() => checkVersions('2.3.4', { version: '2.3.4' }, { version: '2.3.4' })).not.toThrow()
  })
  it.each(['', 'v2.3.4', '2.3.5', 'sample-tag', '2.3.4\n'])('rejects tag %j', (tag) => {
    expect(() => checkVersions(tag, { version: '2.3.4' }, { version: '2.3.4' })).toThrow()
  })
  it('refuses mismatched package versions', () => {
    expect(() => checkVersions('2.3.4', { version: '2.3.4' }, { version: '2.3.5' })).toThrow()
  })
  it.each(['__abeleTest', 'sourceMappingURL'])('rejects the development marker %s', (marker) => {
    expect(() => checkBuild(['main.js', 'main.css'], `/* ${marker} */`)).toThrow()
  })
  it('refuses missing assets and extra chunks or sourcemaps', () => {
    for (const names of [
      ['main.js'],
      ['main.css'],
      ['main.js', 'main.css', 'chunk.js'],
      ['main.js', 'main.css', 'main.js.map'],
    ]) {
      expect(() => checkBuild(names, 'production')).toThrow()
    }
    expect(() => checkBuild(['main.js', 'main.css'], 'production')).not.toThrow()
  })
})
