import { afterEach, expect, it, vi } from 'vitest'
import { tokenBuildFixture } from '../helpers/tokenBuildFixture'
import {
  activateExternalFiles,
  discardOrphanPrivateArtifacts,
  recoverExternalState,
} from '@/sync/external/pluginSafety'
import { openTokenLedger } from '@/sync/tokenLedger'
import { tokenExternalBinding } from '@/sync/tokenExternalBinding'
import { RuntimeFence, EXTERNAL_ACTIVATION_KEY } from '@/sync/external/recovery'
import { makeParents } from '@/sync/vaultFolders'
import { reserveStagingPath, stagingDirectory } from '@/sync/stagingDirectory'
let s: Awaited<ReturnType<typeof tokenBuildFixture>> | undefined
afterEach(async () => {
  await s?.close()
  vi.restoreAllMocks()
})
it('starts a fresh connection after private projection staging loses its ledger ownership', async () => {
  s = await tokenBuildFixture()
  const path = stagingDirectory(s.app.vault.configDir) + '/.abele-external-sample-orphan.incoming'
  await makeParents(s.app.vault.adapter, path)
  await s.app.vault.adapter.write(path, '{"format":"abele.external"}')
  const fence = new RuntimeFence(s.app, s.record.ledgerId, () => true)
  try {
    await expect(
      recoverExternalState(
        s.app as never,
        s.store,
        s.record.ledgerId,
        s.record.ledgerId,
        s.binding,
        fence,
        s.factory
      )
    ).resolves.toBeUndefined()
    expect(await s.app.vault.adapter.exists(path)).toBe(false)
    expect(await s.app.vault.adapter.read('Media/sample.bin')).toBe('sample original')
  } finally {
    fence.release()
  }
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

it('keeps pending publication recovery and active probe files while sweeping orphan work', async () => {
  s = await tokenBuildFixture()
  const directory = stagingDirectory(s.app.vault.configDir)
  const paths = ['pending.tmp', 'original.old', 'probe.bin', 'orphan.tmp'].map(
    (name) => directory + '/' + name
  )
  for (const path of paths) {
    await makeParents(s.app.vault.adapter, path)
    await s.app.vault.adapter.write(path, 'sample bytes')
  }
  s.app.saveLocalStorage('abele-sync-writes', [
    { target: 'Media/sample.bin', temp: paths[0], backup: paths[1] },
  ])
  const release = reserveStagingPath(paths[2])
  try {
    await discardOrphanPrivateArtifacts(s.app as never, s.factory)
    for (const path of paths.slice(0, 3)) expect(await s.app.vault.adapter.exists(path)).toBe(true)
    expect(await s.app.vault.adapter.exists(paths[3])).toBe(false)
  } finally {
    release()
  }
  await discardOrphanPrivateArtifacts(s.app as never, s.factory)
  expect(await s.app.vault.adapter.exists(paths[2])).toBe(false)
})
