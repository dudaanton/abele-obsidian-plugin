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
import { fileURLToPath } from 'node:url'
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
      packages: {
        [name]: {
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
  return { root, installed, archive }
}
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('sync input provenance preflight', () => {
  it('verifies the real committed payload and installed packages', () => {
    expect(verifySyncInputs().commit).toBe('68bb5bb893a98d2ec89b86cdc511805be6f7d229')
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
