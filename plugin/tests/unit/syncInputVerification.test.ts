// @vitest-environment node
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifySyncInputs, verifySyncFixture } from '../../scripts/verify-sync-inputs.mjs'

const temporary: string[] = []
const sha = (text: string) => createHash('sha256').update(text).digest('hex')
function sample() {
  const root = mkdtempSync(join(tmpdir(), 'sample-sync-inputs-'))
  temporary.push(root)
  const name = '@abele/sync-core',
    archive = 'sample-core.tgz',
    payload = 'sample archive'
  const installed = join(root, 'node_modules', name)
  mkdirSync(installed, { recursive: true })
  mkdirSync(join(root, 'vendor/sync'), { recursive: true })
  writeFileSync(join(root, 'vendor/sync', archive), payload)
  writeFileSync(join(installed, 'package.json'), '{}')
  writeFileSync(
    join(root, 'vendor/sync/provenance.json'),
    JSON.stringify({
      commit: 'b'.repeat(40),
      lockSha256: 'c'.repeat(64),
      packages: {
        [name]: {
          tree: 'd'.repeat(40),
          archive,
          sha256: sha(payload),
          integrity: 'sample-integrity',
          files: { 'package.json': sha('{}') },
        },
      },
    })
  )
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: { [name]: 'file:vendor/sync/' + archive } })
  )
  writeFileSync(
    join(root, 'package-lock.json'),
    JSON.stringify({
      packages: {
        ['node_modules/' + name]: {
          resolved: 'file:vendor/sync/' + archive,
          integrity: 'sample-integrity',
        },
      },
    })
  )
  // Both inputs and all exported entry files exist in a valid fixture. Individual tests
  // corrupt one part without relaxing the provenance contract.
  const protocol = '@abele/sync-protocol'
  const protocolInstalled = join(root, 'node_modules', protocol)
  mkdirSync(join(installed, 'dist'))
  writeFileSync(join(installed, 'dist/index.js'), 'sample runtime')
  writeFileSync(join(installed, 'dist/index.d.ts'), 'sample types')
  cpSync(installed, protocolInstalled, { recursive: true })
  const provenancePath = join(root, 'vendor/sync/provenance.json')
  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))
  provenance.packages[name].files['dist/index.js'] = sha('sample runtime')
  provenance.packages[name].files['dist/index.d.ts'] = sha('sample types')
  provenance.packages[protocol] = provenance.packages[name]
  writeFileSync(provenancePath, JSON.stringify(provenance))
  const manifestPath = join(root, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies[protocol] = manifest.dependencies[name]
  writeFileSync(manifestPath, JSON.stringify(manifest))
  const lockPath = join(root, 'package-lock.json')
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  lock.packages['node_modules/' + protocol] = lock.packages['node_modules/' + name]
  writeFileSync(lockPath, JSON.stringify(lock))
  return { root, installed, archive }
}
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('sync input provenance preflight', () => {
  it('verifies the real committed payload and installed packages', () => {
    expect(verifySyncInputs().commit).toBe('c3cec3ff2d0831d10fa13fc76338c4c78ed40be3')
  })
  it('refuses provenance that omits one of the pinned inputs', () => {
    const { root } = sample()
    const path = join(root, 'vendor/sync/provenance.json')
    const value = JSON.parse(readFileSync(path, 'utf8'))
    delete value.packages['@abele/sync-protocol']
    writeFileSync(path, JSON.stringify(value))
    expect(() => verifySyncInputs(root)).toThrow(/incomplete/i)
  })
  it('refuses an empty exported-file checksum inventory', () => {
    const { root } = sample()
    const path = join(root, 'vendor/sync/provenance.json')
    const value = JSON.parse(readFileSync(path, 'utf8'))
    value.packages['@abele/sync-core'].files = {}
    writeFileSync(path, JSON.stringify(value))
    expect(() => verifySyncInputs(root)).toThrow(/incomplete/i)
  })
  it('refuses tampered archive bytes', () => {
    const { root, archive } = sample()
    writeFileSync(join(root, 'vendor/sync', archive), 'changed')
    expect(() => verifySyncInputs(root)).toThrow(/checksum/)
  })
  it('refuses installed bytes different from the pinned package', () => {
    const { root, installed } = sample()
    writeFileSync(join(installed, 'package.json'), '{"changed":true}')
    expect(() => verifySyncInputs(root)).toThrow(/input mismatch/)
  })
  it('refuses an installed sibling link even when payload bytes match', () => {
    const { root, installed } = sample()
    const external = join(root, 'external-package')
    cpSync(installed, external, { recursive: true })
    rmSync(installed, { recursive: true })
    symlinkSync(external, installed)
    expect(() => verifySyncInputs(root)).toThrow(/Linked/)
  })
  it('does not allow an implicit, unproven or wrong-revision server fixture', () => {
    expect(() => verifySyncFixture(undefined)).toThrow(/ABELE_SYNC_DIR/)
    const { root } = sample()
    expect(() => verifySyncFixture(root)).toThrow(/provenance/)
    writeFileSync(join(root, '.abele-sync-fixture.json'), '{"commit":"wrong"}')
    expect(() => verifySyncFixture(root)).toThrow(/revision/)
  })
})
