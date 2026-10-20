import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@abele/sync-sdk/core'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { tokenOffloadConnection } from '@/sync/tokenOffloadConnection'
import { tokenOffloadsOf } from '@/sync/tokenOffloadCoordinator'
import { pathCoordinatorOf } from '@/sync/pathCoordinator'
import { RuntimeFence } from '@/sync/external/recovery'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

export async function externalFileFixture(
  path = 'Media/sample.png',
  verify = async () => {},
  capture = async () => {},
  download?: () => Promise<Uint8Array>
) {
  const text = 'sample original bytes',
    bytes = new TextEncoder().encode(text)
  const app = buildFakeVault([{ path, content: text }])
  Object.assign(app.workspace, { iterateAllLeaves: () => {} })
  const factory = new IDBFactory(),
    ledgerId = crypto.randomUUID()
  const state = await IndexedDbStateStore.open(factory, ledgerId)
  const fence = new RuntimeFence(app, ledgerId, () => true)
  fence.activate()
  const head = {
    path,
    wirePath: path,
    fileId: 'sample-file',
    versionId: 'sample-version',
    sha: await sha256(bytes),
    size: bytes.length,
    mtime: 1000,
  }
  await state.put(head)
  const binding = {
    endpoint: 'https://sync.example',
    vaultId: 'sample-space',
    mode: 'token' as const,
    principalId: 'sample-token',
    principalType: 'token' as const,
    grantId: null,
    generation: 1,
    credentialAssociation: 'sample-slot',
  }
  const fs = new ObsidianFileSystem(app as never)
  const manager = tokenOffloadsOf(app.vault, pathCoordinatorOf(app.vault))
  const port = await tokenOffloadConnection({
    app: app as never,
    factory,
    state,
    ledgerId,
    fence,
    binding,
    fs,
    manager,
    scriptsFolder: () => 'Scripts',
    client: () =>
      ({
        verifyExternalFile: async () => {
          await verify()
          return {
            file_id: head.fileId,
            version_id: head.versionId,
            path,
            sha: head.sha,
            size: head.size,
            verified: true,
          }
        },
        versionBytes: async () => (download ? download() : bytes),
      }) as never,
    sync: async () => {},
    includes: () => true,
    capture,
    rememberIdentity: () => {},
    hydratedIdentity: () => {},
  })
  return {
    app,
    manager,
    port,
    path,
    state,
    bytes,
    factory,
    binding,
    fs,
    head,
    close: () => {
      port.close()
      fence.release()
      state.close()
    },
  }
}
