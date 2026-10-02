// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256 } from '@abele/sync-core'
import { ScopedPushIntegration } from '@/sync/publication/scopedPushIntegration'
import { LinkSnapshotStore } from '@/sync/publication/LinkSnapshotStore'
import { scopedPushFixture } from '../helpers/scopedPushFixture'
let f: Awaited<ReturnType<typeof scopedPushFixture>> | undefined
afterEach(async () => {
  await f?.close()
  f = undefined
})
async function setup() {
  f = await scopedPushFixture()
  const binding = {
      localVault: 'sample-local',
      issuer: f.client.binding.endpoint_identity,
      vaultId: f.vault,
      principal: f.a.key_id,
      facet: 'scoped' as const,
      grantId: f.grant.id,
    },
    meta = f.raw,
    snapshots = new LinkSnapshotStore(meta, binding, () => true)
  const observe = vi.fn(async (item: any, bytes: Uint8Array) => {
    const source = new TextDecoder().decode(bytes),
      cacheJson = '{"sample":true}'
    return {
      noteId: item.file_id,
      versionId: item.version_id,
      source,
      origin: 'push' as const,
      facts: [],
      evidence: {
        adapter: 'fixture',
        runtime: 'fixture',
        generation: '1',
        noteId: item.file_id,
        versionId: item.version_id,
        sourceSha: item.sha,
        cacheSha: await sha256(new TextEncoder().encode(cacheJson)),
        cacheJson,
        complete: true,
      },
    }
  })
  const make = (enabled = true) =>
    new ScopedPushIntegration(meta, binding, snapshots, observe, () => enabled)
  const bytes = new TextEncoder().encode('sample immutable note')
  await f.fs.writeAtomic('Agents/sample.md', bytes, 1)
  const ops = [
    {
      op: 'create' as const,
      path: 'Agents/sample.md',
      sha: await sha256(bytes),
      size: bytes.length,
      mtime: 1,
    },
  ]
  return { binding, meta, snapshots, observe, make, bytes, ops }
}
describe('reviewed scoped push exact-version hook integration', () => {
  it('is disabled by default before any journal/upload/network operation', async () => {
    const s = await setup(),
      m = new ScopedPushIntegration(s.meta, s.binding, s.snapshots, s.observe)
    await expect(m.push({ ...f!, ops: s.ops, stillHeld: () => true })).rejects.toThrow(/disabled/)
    expect(await f!.state.getJournal()).toBeNull()
    expect(f!.client.putBlob).not.toHaveBeenCalled()
  })
  it('survives death before upload and after file placement, reuses the real receipt and durable exact baseline', async () => {
    const s = await setup()
    const options = { ...f!, ops: s.ops, stillHeld: () => true }
    await expect(
      s.make().push({
        ...options,
        beforeUpload: async () => {
          throw new Error('Synthetic before upload death')
        },
      })
    ).rejects.toThrow(/before upload death/)
    expect(f!.client.putBlob).not.toHaveBeenCalled()
    const first = (await f!.state.getJournal())!.request_id
    await expect(
      s.make().push({
        ...options,
        onSettled: async () => {
          throw new Error('Synthetic after placement death')
        },
      })
    ).rejects.toThrow(/after placement death/)
    const entry = await f!.state.getEntry('Agents/sample.md')
    expect(entry).not.toBeNull()
    expect(await f!.state.getJournal()).not.toBeNull()
    const result = await s.make().push({ ...f!, stillHeld: () => true })
    expect(result.requestId).toBe(first)
    expect(await f!.state.getJournal()).toBeNull()
    expect(f!.client.commit.mock.calls.every(([r]) => r.request_id === first)).toBe(true)
    expect(
      await f!.t.db
        .selectFrom('versions')
        .select('id')
        .where('file_id', '=', entry!.fileId)
        .execute()
    ).toHaveLength(1)
    expect(await s.snapshots.get(entry!.fileId)).toMatchObject({
      kind: 'complete',
      versionId: entry!.versionId,
      sha: s.ops[0].sha,
      origin: 'merge',
      binding: s.binding,
    })
    expect(s.observe).toHaveBeenCalledTimes(2)
  })
  it('refuses a missing persisted unit on staged replay before a commit', async () => {
    const s = await setup()
    f!.client.commit.mockRejectedValueOnce(new Error('Synthetic network loss'))
    await expect(s.make().push({ ...f!, ops: s.ops, stillHeld: () => true })).rejects.toThrow(
      /network loss/
    )
    const id = (await f!.state.getJournal())!.request_id
    const keys = [...(f!.raw as any).meta.keys()].filter((key: string) =>
      key.startsWith('publication-scoped-unit-v1:')
    )
    for (const key of keys) await s.meta.setMeta(key, null)
    await expect(s.make().push({ ...f!, stillHeld: () => true })).rejects.toThrow(
      /missing|recovery/
    )
    expect(f!.client.commit).toHaveBeenCalledTimes(1)
    expect((await f!.state.getJournal())!.request_id).toBe(id)
  })
})
