import { afterEach, expect, it, vi } from 'vitest'
import { tokenBuildFixture } from '../helpers/tokenBuildFixture'
import { ExternalState } from '@/sync/external/state'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
async function fixture() {
  const s = await tokenBuildFixture()
  cleanups.push(s.close)
  s.store.close()
  const built = await s.build()
  return { ...s, built }
}

it('a replacement token key immediately fences local filesystem effects', async () => {
  const s = await fixture()
  s.keys.set(s.record.secretReference, 'b'.repeat(43))
  await expect(s.built.fs.remove('Media/sample.bin')).rejects.toThrow(/ownership|held|recovery/i)
  expect(await s.app.vault.adapter.read('Media/sample.bin')).toBe('sample original')
  expect(s.fetcher).not.toHaveBeenCalled()
})
it('a new token runtime claim fences its predecessor with both raw ledgers still open', async () => {
  const s = await fixture(),
    next = await s.build()
  await expect(s.built.fs.remove('Media/sample.bin')).rejects.toThrow(/ownership|held|recovery/i)
  expect(next.store.permitsEngineEffects).toBe(true)
  expect(await s.app.vault.adapter.read('Media/sample.bin')).toBe('sample original')
})
it('a stale host cannot forget a successor connection through Disconnect', async () => {
  const s = await fixture(),
    before = s.registry.records()
  await s.build()
  await expect(s.built.ui.disconnect(s.id)).rejects.toThrow(/ownership|held|recovery/i)
  expect(s.registry.records()).toEqual(before)
  expect(s.keys.size).toBe(1)
  expect(s.fetcher).not.toHaveBeenCalled()
})
it('a queued Disconnect rechecks its claim after a successor opens during inspection', async () => {
  const s = await fixture()
  let release!: () => void, enter!: () => void
  const hold = new Promise<void>((resolve) => {
      release = resolve
    }),
    entered = new Promise<void>((resolve) => {
      enter = resolve
    })
  const guard = s.built.ui.connectionChangeGuard
  s.built.ui.connectionChangeGuard = async () => {
    enter()
    await hold
    await guard()
  }
  const leaving = s.built.ui.disconnect(s.id)
  await entered
  const next = await s.build(),
    before = s.registry.records()
  release()
  await expect(leaving).rejects.toThrow(/ownership|held|recovery/i)
  expect(s.registry.records()).toEqual(before)
  expect(next.store.permitsEngineEffects).toBe(true)
  expect(s.keys.size).toBe(1)
})
it('a failed inspection retains its live runtime claim and Disconnect can be retried', async () => {
  const s = await fixture()
  await s.app.vault.adapter.write('Media/sample.bin', 'changed ordinary candidate')
  const read = vi
    .spyOn(s.app.vault.adapter, 'readBinary')
    .mockRejectedValueOnce(new Error('sample transient read failure'))
  await expect(s.built.ui.disconnect(s.id)).rejects.toThrow('sample transient read failure')
  expect(s.keys.size).toBe(1)
  expect(s.built.ui.runtimes.has(s.id)).toBe(true)
  read.mockRestore()
  await s.built.ui.disconnect(s.id)
  expect(s.keys.size).toBe(0)
  expect(await s.app.vault.adapter.read('Media/sample.bin')).toBe('changed ordinary candidate')
})
it('an ordinary candidate vanishing during inspection does not prevent safe local disconnect', async () => {
  const s = await fixture(),
    read = s.app.vault.adapter.readBinary.bind(s.app.vault.adapter)
  vi.spyOn(s.app.vault.adapter, 'readBinary').mockImplementation(async (path) => {
    if (path === 'Media/sample.bin') {
      await s.app.vault.adapter.remove(path)
      throw Object.assign(new Error('sample file vanished'), { code: 'ENOENT' })
    }
    return read(path)
  })
  await expect(s.built.ui.disconnect(s.id)).resolves.toBeUndefined()
  expect(s.keys.size).toBe(0)
  expect(s.registry.records()).toEqual([])
})
it('cold token recovery holds pending downloads before watchers or publication replay', async () => {
  const s = await fixture(),
    state = await ExternalState.open(s.built.store, s.record.ledgerId, s.binding)
  await state.commit({
    expectedRevision: 0,
    files: [
      {
        expectedRevision: null,
        next: {
          schema: 1,
          ledgerId: s.record.ledgerId,
          binding: s.binding,
          fileId: 'sample-file',
          representation: 'pending-download',
          preference: 'keep-local',
          pinned: true,
          projectionPath: 'Media/sample.bin.abele-ref',
          projectionSha: 'a'.repeat(64),
          localRevision: 0,
          pendingOperationId: null,
          availability: 'active',
          blockingReason: 'recovery-required',
          lastProvenLocalBase: null,
          retained: [],
        },
      },
    ],
  })
  await s.built.host.close()
  await expect(s.build()).rejects.toThrow(/external|recovery/i)
  expect(s.fetcher).not.toHaveBeenCalled()
})
