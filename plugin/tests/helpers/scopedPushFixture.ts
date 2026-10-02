import { vi } from 'vitest'
import {
  createScopedClient,
  ScopedState,
  MemoryStateStore,
  MemoryFileSystem,
} from '@abele/sync-core'
import { scopedFixture } from '@abele/sync-server/tests/helpers/scopedFixture.js'
import { prepareFolderAdmissions } from '@abele/sync-server/src/scoped/admissions.js'
import { commitScoped } from '@abele/sync-server/src/scoped/commits.js'
import { uploadScopedBlob } from '@abele/sync-server/src/scoped/uploads.js'
import { readFolderHistoricalVersion } from '@abele/sync-server/src/scoped/history.js'
export async function scopedPushFixture() {
  const f = await scopedFixture('sqlite')
  await prepareFolderAdmissions(f.deps, f.owner.accountToken, f.vault, f.grant.id)
  const bound = await createScopedClient({
    baseUrl: f.deps.endpointIdentity,
    token: f.a.key_token,
    fetch: vi.fn() as unknown as typeof fetch,
    vaultId: f.vault,
    grantId: f.grant.id,
    principalId: f.a.key_id,
    principalKind: 'key',
  })
  const raw = new MemoryStateStore(),
    state = await ScopedState.open(raw, bound.binding, { initialize: true }),
    fs = new MemoryFileSystem()
  const client = {
    binding: bound.binding,
    negotiate: async () => ({ state: { state: 'active', role: 'editor' } }),
    putBlob: vi.fn((sha: string, bytes: Uint8Array) =>
      uploadScopedBlob(f.deps, f.a.key_token, f.vault, f.grant.id, sha, bytes)
    ),
    commit: vi.fn((request: any) =>
      commitScoped(f.deps, f.a.key_token, f.vault, f.grant.id, request.request_id, request.ops)
    ),
    version: async (file: string, version: string) =>
      new Uint8Array(
        (
          await readFolderHistoricalVersion(
            f.deps,
            f.a.key_token,
            f.vault,
            f.grant.id,
            file,
            version,
            { method: 'GET' }
          )
        ).body!
      ),
  }
  return { ...f, raw, state, fs, client }
}
