import { afterEach, expect, it, vi } from 'vitest'
import { tokenBuildFixture } from '../helpers/tokenBuildFixture'
import { activateExternalFiles, recoverExternalState } from '@/sync/external/pluginSafety'
import { openTokenLedger } from '@/sync/tokenLedger'
import { tokenExternalBinding } from '@/sync/tokenExternalBinding'
import { RuntimeFence, EXTERNAL_ACTIVATION_KEY } from '@/sync/external/recovery'
let s: Awaited<ReturnType<typeof tokenBuildFixture>> | undefined
afterEach(async () => {
  await s?.close()
  vi.restoreAllMocks()
})
it('activating independent token ledgers concurrently retains both ownership proofs', async () => {
  s = await tokenBuildFixture()
  const id = s.registry.add(),
    scope = { kind: 'folder' as const, id: 'other-root', path: '/' },
    key = 'b'.repeat(43)
  s.registry.attach(
    id,
    { v: 1, address: 'https://other.example', key, scope },
    { protocol: 2, space_id: 'other-space', token_id: 'other-token', status: 'active', scope },
    {
      get: (ref) => s!.keys.get(ref) ?? null,
      set: (ref, value) => {
        s!.keys.set(ref, value)
      },
      remove: (ref) => {
        s!.keys.delete(ref)
      },
    }
  )
  const second = s.registry.records().find((one) => one.id === id)!,
    store = await openTokenLedger(s.factory, s.registry, second, () => {}),
    binding = await tokenExternalBinding(second, key)
  try {
    await Promise.all([
      activateExternalFiles(
        s.app as never,
        s.store,
        s.record.ledgerId,
        s.record.ledgerId,
        s.binding,
        () => {}
      ),
      activateExternalFiles(
        s.app as never,
        store,
        second.ledgerId,
        second.ledgerId,
        binding,
        () => {}
      ),
    ])
    const marker = s.app.loadLocalStorage(EXTERNAL_ACTIVATION_KEY) as {
      ledgers: { databaseName: string; phase: string }[]
    }
    expect(marker.ledgers.map((one) => one.databaseName).sort()).toEqual(
      [s.record.ledgerId, second.ledgerId].sort()
    )
    expect(marker.ledgers.every((one) => one.phase === 'active')).toBe(true)
  } finally {
    store.close()
  }
})
it('another activated connection does not prevent a fresh independent token ledger from starting', async () => {
  s = await tokenBuildFixture()
  await activateExternalFiles(
    s.app as never,
    s.store,
    s.record.ledgerId,
    s.record.ledgerId,
    s.binding,
    () => {}
  )
  const fresh = await import('@/sync/IndexedDbStateStore').then(({ IndexedDbStateStore }) =>
      IndexedDbStateStore.open(s!.factory, 'sample-fresh-ledger')
    ),
    fence = new RuntimeFence(s.app, 'sample-fresh-ledger', () => true)
  try {
    await expect(
      recoverExternalState(
        s.app as never,
        fresh,
        'sample-fresh-ledger',
        'sample-fresh-ledger',
        s.binding,
        fence,
        s.factory
      )
    ).resolves.toBeUndefined()
  } finally {
    fresh.close()
    fence.release()
  }
})
