import { expect, it, vi } from 'vitest'
import type { FileSystem } from '@abele/sync-sdk/core'
import { nativeInstallBatch, type InstallBatchHost } from '@/sync/nativeInstallBatch'
import { WriteJournal } from '@/sync/writeJournal'

const items = [
  { path: 'Notes/Example.md', size: 4, sha: 'a'.repeat(64), mtime: 1 },
  { path: 'Notes/Other.md', size: 4, sha: 'b'.repeat(64), mtime: 1 },
]

function fixture() {
  // Only committed journal rows and stage bytes survive the simulated process cut.
  const committed = new Map<string, unknown>()
  const storage = {
    loadLocalStorage: (key: string) => structuredClone(committed.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      committed.set(key, structuredClone(value))
    },
  }
  const bytes = new Map<string, number>()
  let next = 0
  const events: unknown[] = []
  const fingerprint = vi.fn(async (path: string) => {
    events.push('fingerprint')
    return { size: bytes.get(path) ?? 0, sha: items[0].sha }
  })
  const make = () =>
    ({
      fs: { stat: async () => null } as unknown as FileSystem,
      disk: { stat: async (path: string) => (bytes.has(path) ? {} : null) },
      native: {
        syncFile: async () => {},
        syncPath: async () => {},
        installExclusive: async () => {},
        sameObject: async () => true,
      },
      io: {
        create: async (path: string) => {
          bytes.set(path, 0)
        },
        append: async (path: string, offset: number, value: Uint8Array) => {
          bytes.set(path, offset + value.length)
        },
        fingerprint,
      },
      journal: new WriteJournal(storage),
      freeName: async () => `.sample-stage/stage-${next++}`,
      ownsStage: () => true,
      assertReady: () => {},
      validate: () => {},
      parents: async () => {},
      publish: async () => {},
      installed: () => {},
      recoveryVerification: (receipt: unknown) => {
        events.push(receipt)
      },
    }) as unknown as InstallBatchHost
  return { make, fingerprint, events }
}

for (const sealed of [false, true])
  it(`records required private-stage verification after a cut ${sealed ? 'after' : 'before'} seal`, async () => {
    const f = fixture()
    const cut = new Error('simulated process cut')
    await expect(
      nativeInstallBatch(f.make(), items, async (fs) => {
        const stage = await fs.beginAtomicWrite!(items[0].path, 1, null)
        await stage.append(0, new Uint8Array(4))
        if (sealed) await stage.seal({ size: 4, sha: items[0].sha })
        throw cut
      })
    ).rejects.toBe(cut)
    f.fingerprint.mockClear()
    f.events.length = 0
    // Relaunch: no in-memory seal or hash state can be reused as durable identity proof.
    await expect(
      nativeInstallBatch(f.make(), [items[0]], async () => {
        throw cut
      })
    ).rejects.toBe(cut)
    expect(f.fingerprint).toHaveBeenCalledTimes(1)
    expect(f.events).toEqual([
      expect.objectContaining({
        kind: 'private-stage-recovery',
        status: 'started',
        target: items[0].path,
        stage: '.sample-stage/stage-0',
        sha: items[0].sha,
        size: 4,
        usableIdentityReceipt: false,
      }),
      'fingerprint',
      expect.objectContaining({ kind: 'private-stage-recovery', status: 'verified' }),
    ])
  })

it('does not read a stage when a public destination already exists', async () => {
  const f = fixture()
  const host = f.make()
  host.fs.stat = async () => ({ kind: 'file', size: 4, mtime: 1 })
  expect(await nativeInstallBatch(host, items, async () => 'unused')).toBeUndefined()
  expect(f.fingerprint).not.toHaveBeenCalled()
  expect(f.events).toEqual([])
})

for (const failed of [false, true])
  it(`does not certify a ${failed ? 'failed' : 'mismatched'} recovered stage`, async () => {
    const f = fixture()
    const cut = new Error('simulated process cut')
    await expect(
      nativeInstallBatch(f.make(), items, async (fs) => {
        const stage = await fs.beginAtomicWrite!(items[0].path, 1, null)
        await stage.append(0, new Uint8Array(4))
        throw cut
      })
    ).rejects.toBe(cut)
    f.events.length = 0
    f.fingerprint.mockClear()
    f.fingerprint.mockImplementationOnce(async () => {
      f.events.push('fingerprint')
      if (failed) throw new Error('stage disappeared')
      return { size: 4, sha: items[1].sha }
    })
    let offset: number | undefined
    const result = await nativeInstallBatch(f.make(), [items[0]], async (fs) => {
      offset = (await fs.beginAtomicWrite!(items[0].path, 1, null)).offset
      throw cut
    }).catch((error: unknown) => error)
    expect(result).toBe(failed ? undefined : cut)
    expect(offset).toBe(failed ? undefined : 0)
    expect(f.fingerprint).toHaveBeenCalledTimes(1)
    expect(f.events).toEqual([
      expect.objectContaining({ status: 'started' }),
      'fingerprint',
      expect.objectContaining({
        status: failed ? 'failed' : 'mismatch',
        completedAt: expect.any(Number),
      }),
    ])
  })
