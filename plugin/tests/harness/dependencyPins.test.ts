import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))

describe('reproducible dependency sources', () => {
  for (const group of ['dependencies', 'devDependencies']) {
    it(`pins every ${group} entry to its locked registry release`, () => {
      for (const [name, version] of Object.entries(manifest[group])) {
        expect(version, name).toMatch(/^\d+\.\d+\.\d+$/)
        const installed = lock.packages[`node_modules/${name}`]
        expect(installed.version, name).toBe(version)
        expect(installed.resolved, name).toMatch(/^https:\/\/registry\.npmjs\.org\//)
        expect(installed.integrity, name).toMatch(/^sha512-/)
      }
    })
  }
  it('saves future dependencies exactly', () => {
    expect(readFileSync('.npmrc', 'utf8')).toMatch(/^save-exact=true$/m)
  })
})
