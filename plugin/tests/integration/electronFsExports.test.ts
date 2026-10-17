// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFakeVault } from '../helpers/fakeVault'
import { desktopNodeFs } from '@/sync/vaultPathLinks'
import { Platform } from 'obsidian'

afterEach(() => {
  vi.doUnmock('node:fs')
  vi.resetModules()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it.each([true, false])(
  'handles default-only Electron filesystem exports (no-follow available: %s)',
  async (available) => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    vi.doMock('node:fs', () => ({
      default: {
        ...actual,
        constants: { ...actual.constants, O_NOFOLLOW: undefined },
      },
    }))
    vi.resetModules()
    const { guardedVaultAdapter } = await import('@/sync/vaultPathLinks')
    vi.stubGlobal('window', {
      require: vi.fn((name: string) => {
        expect(name).toBe('fs')
        return {
          ...actual,
          constants: available ? actual.constants : { ...actual.constants, O_NOFOLLOW: undefined },
        }
      }),
    })
    const root = await fs.mkdtemp(join(tmpdir(), 'sample-electron-exports-'))
    try {
      await fs.writeFile(join(root, 'sample.md'), 'sample')
      const app = buildFakeVault([])
      const adapterOpen = vi.fn(() => {
        throw new Error('Adapter open must not provide the native module')
      })
      Object.assign(app.vault.adapter, {
        getFullPath: (path: string) => join(root, path),
        fsPromises: { ...fs, open: adapterOpen },
      })
      const disk = guardedVaultAdapter(app.vault.adapter)
      if (!available) {
        await expect(disk.read('sample.md')).rejects.toThrow(
          "accessor: window.require('fs'); missing: constants.O_NOFOLLOW"
        )
        return
      }
      expect(await disk.read('sample.md')).toBe('sample')
      await disk.write('sample.md', 'updated')
      await disk.rename('sample.md', 'renamed.md')
      expect(await fs.readFile(join(root, 'renamed.md'), 'utf8')).toBe('updated')
      await disk.remove('renamed.md')
      await fs.symlink(join(root, 'missing'), join(root, 'linked.md'))
      await expect(disk.write('linked.md', 'blocked')).rejects.toThrow(/symbolic link/i)
      expect(adapterOpen).not.toHaveBeenCalled()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)

it('returns the actual desktop module through window.require', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  const require = vi.fn(() => actual)
  vi.stubGlobal('window', { require })
  expect(desktopNodeFs()).toBe(actual)
  expect(require).toHaveBeenCalledExactlyOnceWith('fs')
})

it('keeps native reads and mutations available in desktop phone UI mode', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  const { Platform: runtime } = await import('obsidian')
  vi.spyOn(runtime, 'isDesktop', 'get').mockReturnValue(false)
  vi.spyOn(runtime, 'isMobile', 'get').mockReturnValue(true)
  expect(runtime.isDesktopApp).toBe(true)
  const { guardedVaultAdapter } = await import('@/sync/vaultPathLinks')
  vi.stubGlobal('window', { require: vi.fn(() => actual) })
  const root = await fs.mkdtemp(join(tmpdir(), 'sample-desktop-phone-ui-'))
  try {
    await fs.writeFile(join(root, 'sample.md'), 'sample')
    const app = buildFakeVault([])
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: fs,
    })
    const disk = guardedVaultAdapter(app.vault.adapter)
    await expect(disk.read('sample.md')).resolves.toBe('sample')
    await disk.rename('sample.md', 'moved.md')
    await disk.remove('moved.md')
    expect(await fs.readdir(root)).toEqual([])
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

it.each(['absent', 'throws', 'missing keys', 'mobile'])(
  'explains unavailable desktop filesystem capabilities: %s',
  (scenario) => {
    const require = vi.fn(() => {
      if (scenario === 'throws') throw new Error('Unavailable')
      return {}
    })
    vi.stubGlobal('window', scenario === 'absent' ? {} : { require })
    if (scenario === 'mobile') {
      vi.spyOn(Platform, 'isDesktop', 'get').mockReturnValue(false)
      vi.spyOn(Platform, 'isDesktopApp', 'get').mockReturnValue(false)
      vi.spyOn(Platform, 'isMobileApp', 'get').mockReturnValue(true)
    }
    const missing = {
      absent: 'window.require',
      throws: 'fs module (require failed)',
      'missing keys': 'constants.O_RDONLY',
      mobile: 'desktop runtime',
    }[scenario]
    expect(() => desktopNodeFs()).toThrow("accessor: window.require('fs'); missing: " + missing)
    if (scenario === 'mobile') expect(require).not.toHaveBeenCalled()
  }
)
