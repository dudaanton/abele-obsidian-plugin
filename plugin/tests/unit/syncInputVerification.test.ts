// @vitest-environment node
import {
  constants,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SDK_INPUT, verifySyncSdkInputs } from '../../scripts/verify-sync-sdk.mjs'
import { verifySyncFixture } from '../../scripts/sync-server-fixture.mjs'

const temporary: string[] = []
function sample() {
  const root = mkdtempSync(join(tmpdir(), 'sample-sdk-inputs-'))
  temporary.push(root)
  const source = resolve('node_modules/@abele/sync-sdk')
  const installed = join(root, 'node_modules/@abele/sync-sdk')
  cpSync(source, installed, {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
    filter: (file) => !file.startsWith(join(source, 'node_modules')),
  })
  // Independent copy-on-write extents avoid copying the archive payload for every
  // mutation case. Unsupported filesystems retain ordinary copy semantics.
  cpSync(resolve('vendor'), join(root, 'vendor'), {
    recursive: true,
    mode: constants.COPYFILE_FICLONE,
  })
  for (const file of ['package.json', 'package-lock.json']) cpSync(resolve(file), join(root, file))
  return { root, installed }
}
afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true })
})
describe('npm sync SDK input preflight', () => {
  it('verifies the audited npm version, integrity and installed package bytes', () => {
    const input = verifySyncSdkInputs()
    expect(input.version).toBe('0.3.15')
    expect(input.source).toBe('file:vendor/sync/abele-sync-sdk-0.3.15.tgz')
    expect(input.sha256).toBe('aeb9955f9d2cddc88d7ac7b4f53aa51343f05959d9d57e4e7b0e91503d44b749')
    expect(input.integrity).toBe(
      'sha512-kRiRg1sdSzWSNt7sK+qpP8BYCy3vmExpZQwpiYPrceKrAxWEpb+vDdY9KG15QOqxkV7H94aK/QqkM6wJqxtY9A=='
    )
  })
  it('refuses a manifest that omits the pinned SDK input', () => {
    const { root } = sample(),
      file = join(root, 'package.json'),
      value = JSON.parse(readFileSync(file, 'utf8'))
    delete value.dependencies['@abele/sync-sdk']
    writeFileSync(file, JSON.stringify(value))
    expect(() => verifySyncSdkInputs(root)).toThrow(/Unpinned/)
  })
  it('refuses an incomplete exported-file inventory', () => {
    const saved = SDK_INPUT.files
    try {
      SDK_INPUT.files = {}
      expect(() => verifySyncSdkInputs()).toThrow(/Incomplete/)
    } finally {
      SDK_INPUT.files = saved
    }
  })
  it.each(['version', 'integrity', 'resolved', 'link'])('refuses changed npm lock %s', (key) => {
    const { root } = sample(),
      file = join(root, 'package-lock.json'),
      value = JSON.parse(readFileSync(file, 'utf8'))
    value.packages['node_modules/@abele/sync-sdk'][key] = key === 'link' ? true : 'changed'
    writeFileSync(file, JSON.stringify(value))
    expect(() => verifySyncSdkInputs(root)).toThrow(/Unpinned/)
  })
  it('refuses retired packages even in a nested lock entry', () => {
    const { root } = sample(),
      file = join(root, 'package-lock.json'),
      value = JSON.parse(readFileSync(file, 'utf8'))
    value.packages['node_modules/sample/node_modules/@abele/sync-core'] = { version: '0.4.0' }
    writeFileSync(file, JSON.stringify(value))
    expect(() => verifySyncSdkInputs(root)).toThrow(/Retired/)
  })
  // Copies and hashes real package bytes; loaded filesystem runs can exceed 6 s.
  it('refuses modified installed bytes', () => {
    const { root, installed } = sample()
    writeFileSync(join(installed, 'dist/notes/index.js'), 'changed')
    expect(() => verifySyncSdkInputs(root)).toThrow(/input mismatch/)
  }, 30000)
  it('refuses an incorrect installed package revision', () => {
    const { root, installed } = sample()
    writeFileSync(
      join(installed, 'package.json'),
      JSON.stringify({ name: '@abele/sync-sdk', version: '0.0.0' })
    )
    expect(() => verifySyncSdkInputs(root)).toThrow(/revision mismatch/)
  })
  it('refuses an installed sibling link even when payload bytes match', () => {
    const { root, installed } = sample(),
      external = join(root, 'external-package')
    cpSync(installed, external, { recursive: true })
    rmSync(installed, { recursive: true })
    symlinkSync(external, installed)
    expect(() => verifySyncSdkInputs(root)).toThrow(/Linked/)
  })
  it('does not allow an implicit, unproven or wrong-revision server fixture', () => {
    expect(() => verifySyncFixture(undefined)).toThrow(/ABELE_SYNC_DIR/)
    const { root } = sample()
    expect(() => verifySyncFixture(root)).toThrow(/provenance/)
    writeFileSync(join(root, '.abele-sync-fixture.json'), '{"commit":"wrong"}')
    expect(() => verifySyncFixture(root)).toThrow(/revision/)
  })
})
