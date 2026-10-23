import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([false, true])(
  'uses paired identity without reading source bytes, changed=%s',
  async (changed) => {
    const app = buildFakeVault([{ path: 'sample.bin', content: 'sample bytes', mtime: 1000 }])
    const disk = new ObsidianFileSystem(app as never)
    const host = Reflect.get(Reflect.get(disk, 'conditional'), 'host')
    const expected = { ...(await disk.fingerprint('sample.bin')), identity: 'original-object' }
    host.withMutationCheck = undefined
    host.fileIdentity = async () => 'original-object'
    const fingerprint = vi
      .spyOn(host, 'fingerprint')
      .mockRejectedValue(new Error('Content read forbidden'))
    if (changed) await app.vault.adapter.write('sample.bin', 'changed bytes', { mtime: 2000 })
    expect(
      await disk.conditionalFile({
        path: 'sample.bin',
        expected,
        effect: { kind: 'move', to: 'moved.bin' },
      })
    ).toBe(!changed)
    expect(fingerprint).not.toHaveBeenCalled()
    expect(await app.vault.adapter.exists(changed ? 'sample.bin' : 'moved.bin')).toBe(true)
  }
)

it('does not expose stable identity on adapter-only hosts and refuses supplied identity authority', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'same bytes', mtime: 1000 }])
  const disk = new ObsidianFileSystem(app as never)
  expect(Reflect.get(disk, 'fileIdentity')).toBeUndefined()
  const expected = { ...(await disk.fingerprint('sample.md')), identity: 'original-object' }
  expect(
    await disk.conditionalFile({
      path: 'sample.md',
      expected,
      effect: { kind: 'move', to: 'moved.md' },
    })
  ).toBe(false)
  expect(await app.vault.adapter.read('sample.md')).toBe('same bytes')
  expect(await app.vault.adapter.exists('moved.md')).toBe(false)
})

it('rechecks identity after capture even when bytes and timestamps still match', async () => {
  const app = buildFakeVault([{ path: 'sample.md', content: 'same bytes', mtime: 1000 }])
  const disk = new ObsidianFileSystem(app as never)
  const host = Reflect.get(Reflect.get(disk, 'conditional'), 'host')
  host.fileIdentity = vi.fn(async (path: string) =>
    path.endsWith('/victim') ? 'recreated-object' : 'original-object'
  )
  const expected = { ...(await disk.fingerprint('sample.md')), identity: 'original-object' }
  expect(
    await disk.conditionalFile({
      path: 'sample.md',
      expected,
      effect: { kind: 'move', to: 'moved.md' },
    })
  ).toBe(false)
  expect(await app.vault.adapter.read('sample.md')).toBe('same bytes')
  expect(await app.vault.adapter.exists('moved.md')).toBe(false)
})
