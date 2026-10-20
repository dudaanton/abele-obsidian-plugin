import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { tokenOffloadConnection } from '@/sync/tokenOffloadConnection'
import { TokenOffloadCoordinator } from '@/sync/tokenOffloadCoordinator'
import { PathCoordinator } from '@/sync/pathCoordinator'
import { RuntimeFence } from '@/sync/external/recovery'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { EditCopies } from '@/sync/editCopies'
import { buildFakeVault } from '../helpers/fakeVault'

it('offloads bytes another connection has not received yet after preserving them for it', async () => {
  const path = 'Media/owed.bin',
    bytes = new TextEncoder().encode('sample bytes owed elsewhere')
  const app = buildFakeVault([
    { path, content: 'sample bytes owed elsewhere' },
    { path: 'Media/other.bin', content: 'sample bytes owed elsewhere' },
  ])
  Object.assign(app.workspace, { iterateAllLeaves: () => {} })
  const factory = new IDBFactory(),
    ledgerId = crypto.randomUUID()
  const state = await IndexedDbStateStore.open(factory, ledgerId)
  const fence = new RuntimeFence(app, ledgerId, () => true)
  fence.activate()
  const binding = {
    endpoint: 'https://sync.example',
    vaultId: 'space',
    mode: 'token' as const,
    principalId: 'token',
    principalType: 'token' as const,
    grantId: null,
    generation: 1,
    credentialAssociation: 'slot',
  }
  const head = {
    path,
    wirePath: path,
    fileId: 'file',
    versionId: 'version',
    sha: await sha256(bytes),
    size: bytes.length,
    mtime: 1000,
  }
  await state.put(head)
  await state.put({
    ...head,
    path: 'Media/other.bin',
    wirePath: 'Media/other.bin',
    fileId: 'other-file',
    mtime: 2000,
  })
  // The source connection has the file; a second, paused connection never received it.
  const behind = new MemoryStateStore(),
    copies = new EditCopies(),
    fs = new ObsidianFileSystem(app as never)
  copies.expect([ledgerId, 'behind'])
  copies.register(ledgerId, state, () => true)
  copies.register('behind', behind, () => true)
  const port = await tokenOffloadConnection({
    app: app as never,
    factory,
    state,
    ledgerId,
    binding,
    fence,
    fs,
    manager: new TokenOffloadCoordinator(new PathCoordinator()),
    scriptsFolder: () => 'Scripts',
    client: () =>
      ({
        verifyExternalFile: async () => ({
          file_id: head.fileId,
          version_id: head.versionId,
          path,
          sha: head.sha,
          size: head.size,
          verified: true as const,
        }),
        versionBytes: async () => {
          await port.inspect('Media/other.bin')
          return bytes
        },
      }) as never,
    sync: async () => {},
    includes: () => true,
    capture: (paths) => copies.capture(fs, paths),
    rememberIdentity: () => {},
    hydratedIdentity: () => {},
  })
  try {
    expect((await port.inspect(path)).pinned).toBe(false)
    expect((await port.setPinned(path, true)).status).toBe('complete')
    expect((await port.inspect(path)).pinned).toBe(true)
    expect((await port.evict(path)).status).toBe('pinned')
    expect(await app.vault.adapter.exists(path)).toBe(true)
    expect((await port.setPinned(path, false)).status).toBe('complete')
    expect((await port.evict(path, 'stale-version')).status).toBe('version-changed')
    expect((await port.evict(path)).status).toBe('complete')
    expect(await app.vault.adapter.exists(path)).toBe(false)
    const kept = await copies.list(behind)
    expect(kept.map((one) => [one.path, one.sha])).toEqual([[path, head.sha]])
    expect((await port.inspect(path)).blocked).toBe('already-offloaded')
    expect((await port.setPinned(path, true)).status).toBe('complete')
    expect(await app.vault.adapter.read(path)).toBe('sample bytes owed elsewhere')
    expect((await app.vault.adapter.stat(path))?.mtime).toBe(head.mtime)
    expect((await port.inspect(path)).pinned).toBe(true)
  } finally {
    port.close()
    fence.release()
    state.close()
  }
})
