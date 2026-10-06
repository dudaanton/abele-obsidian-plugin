import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))

describe('reproducible dependency sources', () => {
  for (const group of ['dependencies', 'devDependencies']) {
    // BUG: the registry-only guarantee no longer holds for the four vendored node artifacts.
    // Retain it explicitly; the stronger source/integrity check below covers every dependency.
    const registryOnly = group === 'dependencies' ? it.fails : it
    registryOnly(`pins every ${group} entry to its locked registry release`, () => {
      for (const [name, version] of Object.entries(manifest[group])) {
        expect(version, name).toMatch(/^\d+\.\d+\.\d+$/)
        const installed = lock.packages[`node_modules/${name}`]
        expect(installed.version, name).toBe(version)
        expect(installed.resolved, name).toMatch(/^https:\/\/registry\.npmjs\.org\//)
        expect(installed.integrity, name).toMatch(/^sha512-/)
      }
    })
  }
  it('pins all registry dependencies and exact vendored node tarballs to their actual bytes', () => {
    const artifacts = JSON.parse(readFileSync('vendor/node/integrity.json', 'utf8')) as Array<{ name: string; filename: string; version: string; integrity: string }>
    expect(artifacts.map((a) => a.name).sort()).toEqual(['@abele/channel-client', '@abele/channel-protocol', '@abele/node-client', '@abele/node-protocol'])
    for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const installed = lock.packages[`node_modules/${name}`]
      const artifact = artifacts.find((a) => a.name === name)
      if (artifact) {
        const source = `file:vendor/node/${artifact.filename}`
        expect(version, name).toBe(source)
        expect(installed.resolved, name).toBe(source)
        expect(installed.version, name).toBe(artifact.version)
        const integrity = 'sha512-' + createHash('sha512').update(readFileSync(`vendor/node/${artifact.filename}`)).digest('base64')
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
