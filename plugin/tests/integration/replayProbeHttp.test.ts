// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { scopedApiServer } from '../helpers/scopedApiServer'
import { SyncClient, sha256 } from '@abele/sync-core'
import { observePhoneReplayTransport } from '@/testing/phoneReplay'
import type { App } from 'obsidian'
let server: Awaited<ReturnType<typeof scopedApiServer>> | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})
describe('key-bound server receipt observation', () => {
  it('persists proof only from the actual stored response for the captured key and request bytes', async () => {
    server = await scopedApiServer()
    const { accountToken } = await server.account('sample-replay@example.com'),
      { vaultId } = await server.vault(accountToken, 'Sample receipt'),
      { deviceToken } = await server.device(accountToken, vaultId, 'Sample')
    const normal = new SyncClient({
      baseUrl: 'http://127.0.0.1',
      fetch: server.fetch,
      token: deviceToken,
    }).forVault(vaultId)
    const bytes = new TextEncoder().encode('sample'),
      sha = await sha256(bytes)
    await normal.putBlob(sha, bytes)
    const ops = [
        { op: 'create' as const, path: 'Agents/replay.md', sha, size: bytes.length, mtime: 1 },
      ],
      key = 'sample-captured-key',
      first = await normal.commitRaw(ops, key),
      row = first.body.results[0] as any
    expect(first.replayed).toBe(false)
    const local = new Map<string, unknown>(),
      evidence = {
        path: 'Agents/replay.md',
        content: 'sample',
        fileId: row.file_id,
        versionId: row.version_id,
        beforeCount: 1,
        key,
        requestSha: await sha256(new TextEncoder().encode(JSON.stringify({ ops }))),
      }
    local.set('task14-phone-replay-evidence', evidence)
    const app = {
      loadLocalStorage: (k: string) => local.get(k) ?? null,
      saveLocalStorage: (k: string, v: unknown) => local.set(k, v),
    } as unknown as App
    const observed = new SyncClient({
      baseUrl: 'http://127.0.0.1',
      fetch: observePhoneReplayTransport(app, server.fetch),
      token: deviceToken,
    }).forVault(vaultId)
    expect((await observed.commitRaw(ops, key)).replayed).toBe(true)
    expect((local.get('task14-phone-replay-evidence') as any).serverReplay).toEqual({
      key,
      requestSha: evidence.requestSha,
      fileId: row.file_id,
      versionId: row.version_id,
      replayed: true,
    })
    expect(await normal.versions(row.file_id)).toHaveLength(1)
  })
})
