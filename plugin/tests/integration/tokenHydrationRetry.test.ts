import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@abele/sync-core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { tokenOffloadConnection } from '@/sync/tokenOffloadConnection'
import { TokenOffloadCoordinator } from '@/sync/tokenOffloadCoordinator'
import { PathCoordinator } from '@/sync/pathCoordinator'
import { RuntimeFence } from '@/sync/external/recovery'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

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
