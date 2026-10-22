import { afterEach, expect, it, vi } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

const root = '.obsidian/plugins/abele/sync-conditional'
const data = (value: string) => new TextEncoder().encode(value)
const week = 7 * 24 * 60 * 60 * 1000
afterEach(() => vi.restoreAllMocks())
async function fixture(legacy = false) {
  const app = buildFakeVault([{ path: 'sample.bin', content: 'before', mtime: 1000 }])
  const disk = new ObsidianFileSystem(app as never)
  expect(
    await disk.conditionalFile({
      path: 'sample.bin',
      expected: { sha: await sha256(data('before')), size: 6, mtime: 1000 },
      effect: { kind: 'write', bytes: data('after'), mtime: 2000, receipt: 'sample-retained' },
    })
  ).toBe(true)
  if (legacy) {
    await app.vault.adapter.rename(
      root + '/trash/sample-retained/victim',
      root + '/objects/sample-retained/victim'
    )
    await app.vault.adapter.remove(root + '/retained/sample-retained.json')
    await app.vault.adapter.rmdir(root + '/trash/sample-retained', true)
  }
  return { app, disk }
}
it('retains displaced bytes independently of receipt cleanup for seven days', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  const { app, disk } = await fixture()
  await disk.discardInstallation('sample-retained')
  expect(await app.vault.adapter.read(root + '/trash/sample-retained/victim')).toBe('before')
  clock.mockReturnValue(100000 + week - 1)
  await new ObsidianFileSystem(app as never).recoverConditionalFiles()
  expect(await app.vault.adapter.exists(root + '/trash/sample-retained/victim')).toBe(true)
  clock.mockReturnValue(100000 + week)
  await new ObsidianFileSystem(app as never).recoverConditionalFiles()
  expect(await app.vault.adapter.exists(root + '/trash/sample-retained/victim')).toBe(false)
  expect(await app.vault.adapter.read('sample.bin')).toBe('after')
})
it('surfaces changed retained bytes visibly instead of deleting them at expiry', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  const { app, disk } = await fixture()
  await disk.discardInstallation('sample-retained')
  await app.vault.adapter.writeBinary(
    root + '/trash/sample-retained/victim',
    data('late save').buffer,
    { mtime: 3000 }
  )
  clock.mockReturnValue(100000 + week)
  await new ObsidianFileSystem(app as never).recoverConditionalFiles()
  const files = (await app.vault.adapter.list('')).files
  expect(files.some((path) => /Recovered copy/.test(path))).toBe(true)
  expect(await Promise.all(files.map((path) => app.vault.adapter.read(path)))).toContain(
    'late save'
  )
  expect(await app.vault.adapter.read('sample.bin')).toBe('after')
})
it('does not use an older operation review as proof of a retained-copy restoration', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  const { app, disk } = await fixture()
  await disk.discardInstallation('sample-retained')
  await app.vault.adapter.mkdir(root + '/review')
  await app.vault.adapter.write(root + '/review/sample-retained.json', '{}')
  await app.vault.adapter.writeBinary(
    root + '/trash/sample-retained/victim',
    data('late save').buffer,
    { mtime: 3000 }
  )
  clock.mockReturnValue(100000 + week)
  await disk.recoverConditionalFiles()
  const files = (await app.vault.adapter.list('')).files
  expect(await Promise.all(files.map((path) => app.vault.adapter.read(path)))).toContain(
    'late save'
  )
})
it('retires the oldest unchanged retained victim first above the byte target', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  const { app, disk } = await fixture()
  await disk.discardInstallation('sample-retained')
  // A small injected target exercises accounting without allocating a large fixture.
  Reflect.set(Reflect.get(disk, 'conditional'), 'retentionBytes', 16 * 1024 + 6)
  clock.mockReturnValue(100001)
  expect(
    await disk.conditionalFile({
      path: 'sample.bin',
      expected: { sha: await sha256(data('after')), size: 5, mtime: 2000 },
      effect: { kind: 'write', bytes: data('latest'), mtime: 3000, receipt: 'sample-newer' },
    })
  ).toBe(true)
  expect(await app.vault.adapter.exists(root + '/trash/sample-retained/victim')).toBe(true)
  await disk.recoverConditionalFiles()
  expect(await app.vault.adapter.exists(root + '/trash/sample-retained/victim')).toBe(false)
  expect(await app.vault.adapter.read(root + '/trash/sample-newer/victim')).toBe('after')
  expect(await app.vault.adapter.read('sample.bin')).toBe('latest')
})
it('does not walk retained metadata per file and still observes expiry', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  const { app, disk } = await fixture()
  const list = vi.spyOn(app.vault.adapter, 'list')
  const missing = () =>
    disk.conditionalFile({
      path: 'missing.bin',
      expected: { sha: '0'.repeat(64), size: 1, mtime: 1000 },
      effect: { kind: 'remove' },
    })
  for (let i = 0; i < 10; i++) expect(await missing()).toBe(true)
  expect(list.mock.calls.filter(([path]) => path === root + '/retained')).toHaveLength(0)
  clock.mockReturnValue(100000 + week)
  expect(await missing()).toBe(true)
  expect(await app.vault.adapter.exists(root + '/trash/sample-retained/victim')).toBe(false)
})
it('never deletes directory contents substituted during an empty-victim retirement', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100000)
  const app = buildFakeVault([{ path: 'empty.bin', content: '', mtime: 0 }])
  const disk = new ObsidianFileSystem(app as never)
  expect(
    await disk.conditionalFile({
      path: 'empty.bin',
      expected: { size: 0, mtime: 0, sha: await sha256(data('')) },
      effect: { kind: 'remove' },
    })
  ).toBe(true)
  const folder = (await app.vault.adapter.list(root + '/trash')).folders[0]
  const host = Reflect.get(Reflect.get(disk, 'conditional'), 'host')
  const fingerprint = host.fingerprint.bind(host)
  const removals: string[] = []
  const remove = host.remove.bind(host)
  host.remove = async (path: string) => {
    removals.push(path)
    await remove(path)
  }
  let injected = false
  host.fingerprint = async (path: string) => {
    const value = await fingerprint(path)
    if (path === folder + '/victim' && !injected) {
      injected = true
      await app.vault.adapter.remove(path)
      await app.vault.adapter.mkdir(path)
      await app.vault.adapter.write(path + '/child.md', 'preserved child')
    }
    return value
  }
  clock.mockReturnValue(100000 + week)
  // This adapter fixture cannot move directories; preserve the evidence and throw.
  await expect(disk.recoverConditionalFiles()).rejects.toThrow()
  expect(injected).toBe(true)
  expect(removals).not.toContain(folder + '/victim')
  expect(await app.vault.adapter.read(folder + '/victim/child.md')).toBe('preserved child')
})
it.each([false, true])(
  'resumes receipt cleanup after a kill following every filesystem await (legacy=%s)',
  async (legacy) => {
    const baseline = await fixture(legacy)
    let count = 0
    const wrap = (app: typeof baseline.app, disk: typeof baseline.disk, stop: number) => {
      let killed = false
      const undo: (() => void)[] = []
      const conditional = Reflect.get(disk, 'conditional')
      const host = Reflect.get(conditional, 'host')
      const boundaries: [object, string[]][] = [
        [app.vault.adapter, Object.keys(app.vault.adapter)],
        [
          host,
          [
            'stat',
            'fingerprint',
            'create',
            'read',
            'mkdir',
            'list',
            'capture',
            'install',
            'restoreDirectory',
            'flush',
            'sameObject',
            'stage',
            'remove',
            'rmdir',
          ],
        ],
        [Reflect.get(disk, 'writer'), ['discardReceipt']],
        [conditional, ['discard']],
      ]
      for (const [owner, keys] of boundaries)
        for (const key of keys) {
          const original = Reflect.get(owner, key)
          if (typeof original !== 'function') continue
          undo.push(() => Reflect.set(owner, key, original))
          Reflect.set(owner, key, async (...args: unknown[]) => {
            if (killed) throw new Error('process stopped')
            const value = await original.apply(owner, args)
            if (++count === stop) {
              killed = true
              throw new Error('process stopped')
            }
            return value
          })
        }
      return () => undo.forEach((restore) => restore())
    }
    const undo = wrap(baseline.app, baseline.disk, Infinity)
    await baseline.disk.discardInstallation('sample-retained')
    undo()
    const boundaries = count
    expect(boundaries).toBeGreaterThan(5)
    console.log('[conditional receipt cleanup crash boundaries]', { legacy, boundaries })
    for (let stop = 1; stop <= boundaries; stop++) {
      const { app, disk } = await fixture(legacy)
      count = 0
      const restore = wrap(app, disk, stop)
      await disk.discardInstallation('sample-retained').catch(() => {})
      expect(count, `injection ${stop}`).toBe(stop)
      restore()
      const restarted = new ObsidianFileSystem(app as never)
      await restarted.recoverConditionalFiles()
      await restarted.discardInstallation('sample-retained')
      await restarted.discardInstallation('sample-retained')
      for (const area of ['active', 'completed', 'review', 'objects', 'retiring']) {
        const path = root + '/' + area
        if (await app.vault.adapter.exists(path)) {
          expect(await app.vault.adapter.list(path), `boundary ${stop}: ${area}`).toEqual({
            files: [],
            folders: [],
          })
        }
      }
      expect(await app.vault.adapter.read('sample.bin')).toBe('after')
      expect(await app.vault.adapter.read(root + '/trash/sample-retained/victim')).toBe('before')
    }
  }
)
