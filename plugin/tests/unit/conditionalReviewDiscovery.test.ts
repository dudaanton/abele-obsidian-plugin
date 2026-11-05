import { afterEach, expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import type { ConditionalFileHost } from '@/sync/conditionalFiles'
import { buildFakeVault } from '../helpers/fakeVault'
import { desktopFsPort } from '../helpers/desktopRequire'
import { virtualNativeVault } from '../helpers/virtualNativeVault'

afterEach(() => vi.restoreAllMocks())

it.each([false, true])(
  'does no repeated review discovery on clean scans (native=%s)',
  async (native) => {
    const fixture = native ? virtualNativeVault() : undefined
    if (fixture) desktopFsPort(fixture.native)
    const app = fixture?.app ?? buildFakeVault([])
    const files = new ObsidianFileSystem(app as never)
    const conditional = Reflect.get(files, 'conditional')
    const host = Reflect.get(conditional, 'host') as ConditionalFileHost
    const stat = vi.spyOn(host, 'stat')
    await conditional.recover()
    expect(stat.mock.calls.filter(([path]) => path === host.root + '/review')).toHaveLength(
      native ? 1 : 0
    )
    stat.mockClear()
    await conditional.recover()
    await conditional.recover()
    expect(stat.mock.calls.filter(([path]) => path === host.root + '/review')).toEqual([])
  }
)

it.each([false, true])(
  'reinspects a native review created after the clean scan (other view=%s)',
  async (other) => {
    const { app, native } = virtualNativeVault()
    desktopFsPort(native)
    await app.vault.adapter.write('sample.md', 'keep local bytes')
    const files = new ObsidianFileSystem(app as never)
    const conditional = Reflect.get(files, 'conditional')
    const host = Reflect.get(conditional, 'host') as ConditionalFileHost
    const stat = vi.spyOn(host, 'stat')
    await conditional.recover()
    stat.mockClear()
    const writer = other ? new ObsidianFileSystem(app as never) : files
    expect(
      await writer.conditionalFile({
        path: 'sample.md',
        expected: { size: 1, mtime: 1, sha: 'a'.repeat(64) },
        effect: {
          kind: 'write',
          receipt: 'sample-receipt',
          bytes: new Uint8Array([1]),
          mtime: 1000,
        },
      })
    ).toBe(false)
    await conditional.recover()
    expect(stat.mock.calls.some(([path]) => path === host.root + '/review')).toBe(true)
    expect(await app.vault.adapter.read('sample.md')).toBe('keep local bytes')
    stat.mockClear()
    await conditional.recover()
    expect(stat.mock.calls.some(([path]) => path === host.root + '/review')).toBe(false)
  }
)
