import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { SDK_INPUT, verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'

const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'))
const artifacts = JSON.parse(readFileSync('vendor/node/integrity.json', 'utf8')) as Array<{
  name: string
  filename: string
  version: string
  integrity: string
}>
const nodeExclusions = new Set(artifacts.map((artifact) => artifact.name))
const registryExclusions = new Set([
  ...nodeExclusions,
  ...(SDK_INPUT.source ? ['@abele/sync-sdk'] : []),
])

describe('reproducible dependency sources', () => {
  it('uses patched Zod for both node protocols without nested copies', () => {
    for (const name of ['node-protocol', 'channel-protocol']) {
      expect(lock.packages[`node_modules/@abele/${name}`].dependencies.zod).toBe('4.6.6')
      expect(lock.packages[`node_modules/@abele/${name}/node_modules/zod`]).toBeUndefined()
    }
  })
  it('excludes exactly the vendored node dependency set from registry checks', () => {
    const vendoredDependencies = Object.entries(manifest.dependencies)
      .filter(([, source]) => typeof source === 'string' && source.startsWith('file:vendor/node/'))
      .map(([name]) => name)
      .sort()
    expect([...nodeExclusions].sort()).toEqual(vendoredDependencies)
    expect([...nodeExclusions].sort()).toEqual([
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
      if (name === '@abele/sync-sdk' && SDK_INPUT.source) {
        expect(version).toBe(`file:vendor/sync/abele-sync-sdk-${SDK_INPUT.version}.tgz`)
        expect(installed.resolved).toBe(version)
        expect(installed.version).toBe(SDK_INPUT.version)
        expect(installed.integrity).toBe(SDK_INPUT.integrity)
        expect(verifySyncSdkInputs()).toBe(SDK_INPUT)
      } else if (artifact) {
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
