import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256, MemoryStateStore } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { inspectFolder } from '@/sync/verifyFolderSet'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { tokenOffloadConnection } from '@/sync/tokenOffloadConnection'
import { TokenOffloadCoordinator } from '@/sync/tokenOffloadCoordinator'
import { PathCoordinator } from '@/sync/pathCoordinator'
import { RuntimeFence } from '@/sync/external/recovery'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'

it.each([
  'verification',
  'download',
  'placement',
  'placement-reload',
  'placement-coordinator',
  'placement-disconnect',
  'follow-sidecar',
  'follow-invalid-sidecar',
])('handles %s hydration through the retained identity', async (phase) => {
  const path = 'Media/sample.bin',
    bytes = new TextEncoder().encode('sample original')
  const placed = phase.startsWith('placement')
  const local = placed ? 'Moved/sample.bin' : path
  const app = buildFakeVault([{ path: local, content: 'sample original' }])
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
  const verify = vi.fn(async () => ({
    file_id: head.fileId,
    version_id: head.versionId,
    path,
    sha: head.sha,
    size: head.size,
    verified: true as const,
  }))
  const download = vi.fn(async () => bytes)
  const manager = new TokenOffloadCoordinator(new PathCoordinator())
  const open = () =>
    tokenOffloadConnection({
      app: app as never,
      factory,
      state,
      ledgerId,
      binding,
      fence,
      fs: new ObsidianFileSystem(app as never),
      placement: placed ? new LocalFolderPlacement('Media', 'Moved') : undefined,
      manager,
      scriptsFolder: () => 'Scripts',
      client: () => ({ verifyExternalFile: verify, versionBytes: download }) as never,
      sync: async () => {},
      includes: () => true,
      capture: async () => {},
      rememberIdentity: () => {},
      hydratedIdentity: () => {},
    })
  let port = await open()
  try {
    expect((await port.evict(local)).status).toBe('complete')
    if (phase.startsWith('follow-')) {
      await app.vault.rename(app.vault.getAbstractFileByPath('Media')!, 'Moved')
      if (phase === 'follow-invalid-sidecar')
        await app.vault.adapter.write('Moved/sample.bin.abele-ref', '{}')
      const metadata = new MemoryStateStore(),
        changed = vi.fn(),
        fetch = vi.fn(async () => {
          throw new Error('No request expected')
        })
      const runtime = new TokenEngineRuntime({
        id: ledgerId,
        encoded: encodeAccessToken({
          v: 1,
          address: 'https://sync.example',
          key: 'a'.repeat(43),
          scope: { kind: 'folder', id: 'folder', path: 'Media' },
        }),
        fs: new ObsidianFileSystem(app as never),
        state,
        reviews: {
          executables: new ExecutableReview(metadata),
          attachments: new AttachmentConsent(metadata),
          close: () => {},
        },
        rootIssue: { kind: 'moved', path: 'Moved' },
        localRootChanged: changed,
        inspectRoot: (path) => inspectFolder(app.vault.adapter, path),
        fetch,
        changed: () => {},
        failed: () => {},
        covers: async () => false,
      })
      vi.spyOn(runtime.engine, 'rescan').mockResolvedValue(undefined)
      vi.spyOn(runtime.engine, 'resume').mockImplementation(() => {})
      vi.spyOn(runtime.engine, 'start').mockImplementation(() => {})
      try {
        if (phase === 'follow-sidecar') {
          await runtime.followRoot()
          expect(changed).toHaveBeenCalledWith('Moved')
        } else {
          await expect(runtime.followRoot()).rejects.toThrow(/aren.t part|missing/i)
          expect(changed).not.toHaveBeenCalled()
        }
        expect(fetch).not.toHaveBeenCalled()
        expect(await app.vault.adapter.exists('Moved/sample.bin')).toBe(false)
      } finally {
        await runtime.close()
      }
      return
    }
    if (placed) {
      expect(await app.vault.adapter.exists(local)).toBe(false)
      expect(await app.vault.adapter.exists(local + '.abele-ref')).toBe(true)
      if (phase === 'placement-reload') {
        port.close()
        port = await open()
      }
      if (phase === 'placement-coordinator') await manager.prepare([local])
      else if (phase === 'placement-disconnect') await port.prepareDisconnect()
      else await port.hydrate(local)
      expect(new Uint8Array(await app.vault.adapter.readBinary(local))).toEqual(bytes)
      expect(await app.vault.adapter.exists(path)).toBe(false)
      expect(await state.get(path)).not.toBeNull()
      expect((await port.setPinned(local, true)).status).toBe('complete')
      expect(JSON.parse((await state.getExternalState())!).files[0].pinned).toBe(true)
      expect((await port.setPinned(local, false)).status).toBe('complete')
      return
    }
    const failing = phase === 'verification' ? verify : download
    const baseline = failing.mock.calls.length
    failing.mockRejectedValueOnce(Object.assign(new Error('Sync interrupted'), { code: 'offline' }))
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    const hydration = port.hydrate(path)
    await vi.waitFor(() => expect(failing.mock.calls.length).toBe(baseline + 1))
    await vi.advanceTimersByTimeAsync(2000)
    await hydration
    expect(new Uint8Array(await app.vault.adapter.readBinary(path))).toEqual(bytes)
    expect(await app.vault.adapter.exists(path + '.abele-ref')).toBe(false)
    const document = JSON.parse((await state.getExternalState())!)
    expect(
      document.operations.filter((one: { kind: string }) => one.kind === 'hydration')
    ).toHaveLength(1)
    expect(document.files[0].pendingOperationId).toBeNull()
    expect(failing.mock.calls.length).toBeGreaterThanOrEqual(baseline + 2)
  } finally {
    vi.useRealTimers()
    port.close()
    fence.release()
    state.close()
  }
})

it.each(['verification', 'download'])(
  'retries one native %s failure inside a single hydration intent',
  async (phase) => {
    const path = 'Media/sample.bin',
      bytes = new TextEncoder().encode('sample original')
    const app = buildFakeVault([{ path, content: 'sample original' }])
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
    const verify = vi.fn(async () => ({
      file_id: head.fileId,
      version_id: head.versionId,
      path,
      sha: head.sha,
      size: head.size,
      verified: true as const,
    }))
    const download = vi.fn(async () => bytes)
    const port = await tokenOffloadConnection({
      app: app as never,
      factory,
      state,
      ledgerId,
      binding,
      fence,
      fs: new ObsidianFileSystem(app as never),
      manager: new TokenOffloadCoordinator(new PathCoordinator()),
      scriptsFolder: () => 'Scripts',
      client: () => ({ verifyExternalFile: verify, versionBytes: download }) as never,
      sync: async () => {},
      includes: () => true,
      capture: async () => {},
      rememberIdentity: () => {},
      hydratedIdentity: () => {},
    })
    try {
      expect((await port.evict(path)).status).toBe('complete')
      const failing = phase === 'verification' ? verify : download
      const baseline = failing.mock.calls.length
      failing.mockRejectedValueOnce(
        Object.assign(new Error('Sync interrupted'), { code: 'offline' })
      )
      vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
      const hydration = port.hydrate(path)
      await vi.waitFor(() => expect(failing.mock.calls.length).toBe(baseline + 1))
      await vi.advanceTimersByTimeAsync(2000)
      await hydration
      expect(new Uint8Array(await app.vault.adapter.readBinary(path))).toEqual(bytes)
      expect(await app.vault.adapter.exists(path + '.abele-ref')).toBe(false)
      const document = JSON.parse((await state.getExternalState())!)
      expect(
        document.operations.filter((one: { kind: string }) => one.kind === 'hydration')
      ).toHaveLength(1)
      expect(document.files[0].pendingOperationId).toBeNull()
      expect(failing.mock.calls.length).toBeGreaterThanOrEqual(baseline + 2)
    } finally {
      vi.useRealTimers()
      port.close()
      fence.release()
      state.close()
    }
  }
)
