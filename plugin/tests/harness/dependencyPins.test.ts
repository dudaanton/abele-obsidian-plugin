import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const artifacts = JSON.parse(readFileSync('vendor/node/integrity.json', 'utf8')) as Array<{
  name: string
  filename: string
  version: string
  integrity: string
}>
const registryExclusions = new Set(artifacts.map((artifact) => artifact.name))

describe('reproducible dependency sources', () => {
  it('excludes exactly the vendored node dependency set from registry checks', () => {
    const vendoredDependencies = Object.entries(manifest.dependencies)
      .filter(([, source]) => typeof source === 'string' && source.startsWith('file:vendor/node/'))
      .map(([name]) => name)
      .sort()
    expect([...registryExclusions].sort()).toEqual(vendoredDependencies)
    expect([...registryExclusions].sort()).toEqual([
      '@abele/channel-client',
      '@abele/channel-protocol',
      '@abele/node-client',
      '@abele/node-protocol',
    ])
  })
  for (const group of ['dependencies', 'devDependencies']) {
    it(`pins every ${group} entry to its locked registry release`, () => {
      for (const [name, version] of Object.entries(manifest[group])) {
        if (registryExclusions.has(name)) continue
        expect(version, name).toMatch(/^\d+\.\d+\.\d+$/)
        const installed = lock.packages[`node_modules/${name}`]
        expect(installed.version, name).toBe(version)
        expect(installed.resolved, name).toMatch(/^https:\/\/registry\.npmjs\.org\//)
        expect(installed.integrity, name).toMatch(/^sha512-/)
      }
    })
  }
  it('pins all registry dependencies and exact vendored node tarballs to their actual bytes', () => {
    expect(artifacts.map((a) => a.name).sort()).toEqual([
      '@abele/channel-client',
      '@abele/channel-protocol',
      '@abele/node-client',
      '@abele/node-protocol',
    ])
    for (const [name, version] of Object.entries({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    })) {
      const installed = lock.packages[`node_modules/${name}`]
      const artifact = artifacts.find((a) => a.name === name)
      if (artifact) {
        const source = `file:vendor/node/${artifact.filename}`
        expect(version, name).toBe(source)
        expect(installed.resolved, name).toBe(source)
        expect(installed.version, name).toBe(artifact.version)
        const integrity =
          'sha512-' +
          createHash('sha512')
            .update(readFileSync(`vendor/node/${artifact.filename}`))
            .digest('base64')
        expect(installed.integrity, name).toBe(integrity)
        expect(artifact.integrity, name).toBe(integrity)
      } else {
        expect(version, name).toMatch(/^\d+\.\d+\.\d+$/)
        expect(installed.version, name).toBe(version)
        expect(installed.resolved, name).toMatch(/^https:\/\/registry\.npmjs\.org\//)
        expect(installed.integrity, name).toMatch(/^sha512-/)
      }
    }
  })
  it('saves future dependencies exactly', () => {
    expect(readFileSync('.npmrc', 'utf8')).toMatch(/^save-exact=true$/m)
  })
})
