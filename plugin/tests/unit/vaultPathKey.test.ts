import { afterEach, expect, it, vi } from 'vitest'
import { Platform } from 'obsidian'
import { vaultPathKey } from '@/sync/vaultPathLinks'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

const originalRequire = Object.getOwnPropertyDescriptor(window, 'require')

afterEach(() => {
  if (originalRequire) Object.defineProperty(window, 'require', originalRequire)
  else Reflect.deleteProperty(window, 'require')
  Object.defineProperty(Platform, 'isMobile', { configurable: true, value: false })
  Object.defineProperty(Platform, 'isDesktopApp', { configurable: true, value: true })
  Reflect.deleteProperty(Platform, 'isIosApp')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function desktop(caseSensitive: boolean, unicodeSensitive: boolean) {
  const files = new Set<string>()
  const key = (path: string) => {
    const unicode = unicodeSensitive ? path : path.normalize('NFC')
    return caseSensitive ? unicode : unicode.toLowerCase()
  }
  const native = {
    mkdtempSync: vi.fn((prefix: string) => prefix + 'sample'),
    writeFileSync: vi.fn((path: string) => files.add(key(path))),
    existsSync: vi.fn((path: string) => files.has(key(path))),
    unlinkSync: vi.fn((path: string) => files.delete(key(path))),
    rmdirSync: vi.fn(),
  }
  Object.defineProperty(window, 'require', { configurable: true, value: () => native })
  const app = buildFakeVault([], { sensitiveNames: caseSensitive })
  Object.assign(app.vault.adapter, { getBasePath: () => '/sample-vault' })
  return { app, native }
}

it.each([true, false])('uses the desktop root case policy: sensitive=%s', (sensitive) => {
  const { app, native } = desktop(sensitive, true)
  const fs = new ObsidianFileSystem(app as never)
  expect(fs.pathKey('Folder/Note.md') === fs.pathKey('folder/note.md')).toBe(!sensitive)
  expect(fs.pathKey('Folder/one.md')).not.toBe(fs.pathKey('Folder/two.md'))
  expect(native.unlinkSync).toHaveBeenCalledOnce()
  expect(native.rmdirSync).toHaveBeenCalledOnce()
  // The decision is stable and the host root is probed once, not for every name.
  fs.pathKey('another.md')
  expect(native.mkdtempSync).toHaveBeenCalledOnce()
})

it.each([true, false])('uses the desktop root Unicode policy: exact=%s', (exact) => {
  const { app } = desktop(true, exact)
  const key = vaultPathKey(app.vault as never)
  expect(key('Caf\u00e9/one.md') === key('Cafe\u0301/one.md')).toBe(!exact)
})

it('keeps independent policies for different desktop roots', () => {
  const exact = desktop(true, true)
  const first = vaultPathKey(exact.app.vault as never)
  const folded = desktop(false, false)
  const second = vaultPathKey(folded.app.vault as never)
  expect(first('A.md')).not.toBe(first('a.md'))
  expect(second('A.md')).toBe(second('a.md'))
  expect(first('A.md')).not.toBe(first('a.md'))
})

it.each([true, false])('uses mobile platform policy without Node: iOS=%s', (ios) => {
  Object.defineProperty(Platform, 'isMobile', { configurable: true, value: true })
  Object.defineProperty(Platform, 'isDesktopApp', { configurable: true, value: false })
  Object.defineProperty(Platform, 'isIosApp', { configurable: true, get: () => ios })
  const requireNode = vi.fn(() => {
    throw new Error('Node unavailable')
  })
  Object.defineProperty(window, 'require', { configurable: true, value: requireNode })
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never)
  expect(fs.pathKey('Folder/A.md')).not.toBe(fs.pathKey('folder/a.md'))
  expect(fs.pathKey('Caf\u00e9/a.md') === fs.pathKey('Cafe\u0301/a.md')).toBe(ios)
  expect(requireNode).not.toHaveBeenCalled()
})

it('detects the desktop volume even under mobile UI emulation', () => {
  Object.defineProperty(Platform, 'isMobile', { configurable: true, value: true })
  const { app } = desktop(false, false)
  const key = vaultPathKey(app.vault as never)
  expect(key('Folder/A.md')).toBe(key('folder/a.md'))
})

it('maps a synchronous name key through local folder placement', () => {
  const { app } = desktop(false, false)
  const disk = new ObsidianFileSystem(app as never)
  const fs = new LocalFolderPlacement('Shared', 'Moved').fileSystem(disk)
  expect(fs.pathKey!('Shared/Folder/A.md')).toBe(disk.pathKey('Moved/folder/a.md'))
  expect(() => fs.pathKey!('Other/a.md')).toThrow()
})

it('forwards pure synchronous keys through a scoped host', () => {
  const { app } = desktop(false, false)
  const disk = new ObsidianFileSystem(app as never)
  const scoped = scopedFileSystem(
    disk,
    () => {},
    () => true
  )
  expect(scoped.pathKey!('Shared/A.md')).toBe(disk.pathKey('shared/a.md'))
})

it('lists both legitimate case-distinct files on an exact desktop volume', async () => {
  const { app } = desktop(true, true)
  await app.vault.adapter.mkdir('Folder')
  await app.vault.adapter.write('Folder/A.md', 'first')
  await app.vault.adapter.write('Folder/a.md', 'second')
  const fs = new ObsidianFileSystem(app as never)
  const listed = await Array.fromAsync(fs.list())
  expect(listed.map((file) => file.path).sort()).toEqual(['Folder/A.md', 'Folder/a.md'])
})

it('does not confuse observed bytes of case-distinct files before a conditional write', async () => {
  const { app } = desktop(true, true)
  await app.vault.adapter.mkdir('Folder')
  await app.vault.adapter.write('Folder/A.md', 'first')
  await app.vault.adapter.write('Folder/a.md', 'other')
  const fs = new ObsidianFileSystem(app as never)
  await fs.read('Folder/A.md')
  await fs.read('Folder/a.md')
  await fs.writeAtomic('Folder/A.md', new TextEncoder().encode('updated'), 2000)
  expect(await app.vault.adapter.read('Folder/A.md')).toBe('updated')
  expect(await app.vault.adapter.read('Folder/a.md')).toBe('other')
})
