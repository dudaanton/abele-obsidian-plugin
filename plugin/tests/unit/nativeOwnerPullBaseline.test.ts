// @vitest-environment node
import { it, expect, vi } from 'vitest'
import { MemoryStateStore, sha256 } from '@abele/sync-core'
import { NativeOwnerPublication } from '@/sync/publication/nativeOwnerPublication'
import { buildFakeVault } from '../helpers/fakeVault'
async function setup() {
  const source = 'received sample\n',
    bytes = new TextEncoder().encode(source),
    sha = await sha256(bytes),
    app = buildFakeVault([{ path: 'Received.md', content: source }]),
    events = new Map<string, (...args: any[]) => void>(),
    meta = new MemoryStateStore(),
    state = new MemoryStateStore()
  ;(app.metadataCache as any).on = (name: string, fn: (...args: any[]) => void) => {
    events.set(name, fn)
    return {}
  }
  ;(app.metadataCache as any).offref = () => {}
  vi.spyOn(state, 'byFileId').mockResolvedValue({
    path: 'Received.md',
    wirePath: 'Received.md',
    fileId: 'sample-received',
    versionId: 'received-v2',
    sha,
    size: bytes.length,
    mtime: 1,
  } as any)
  const p = new NativeOwnerPublication({
    app: app as any,
    meta,
    state,
    client: { commitRaw: vi.fn() } as any,
    binding: {
      localVault: 'sample-local',
      issuer: 'https://sync.example',
      vaultId: 'sample-vault',
      principal: 'sample-owner',
      facet: 'personal',
      grantId: null,
    },
    grants: ['sample-grant'],
    token: () => 'absd_' + 'a'.repeat(43),
    fetch: vi.fn() as any,
    configurationRoots: () => ['.obsidian', 'Scripts'],
    enabled: () => true,
    held: () => true,
    eventTarget: { addEventListener: () => {}, removeEventListener: () => {} } as any,
  })
  await p.start(true)
  events.get('changed')!({ path: 'Received.md' }, source, { links: [], embeds: [] })
  await p.flush()
  return {
    p,
    events,
    state,
    sha,
    bytes,
    event: {
      deliveryId: 'sample-received:received-v2',
      fileId: 'sample-received',
      versionId: 'received-v2',
      path: 'Received.md',
      sha,
      size: bytes.length,
      source: 'personal' as const,
      automatic: 'enabled' as const,
    },
  }
}
it('records an exact received last-synced baseline through the reviewed personal pull hook', async () => {
  const s = await setup()
  try {
    await (s.p.hooks as any).onPersonalNoteApplied(s.event, s.bytes)
    const snapshot = await (s.p as any).snapshots.get(s.event.fileId)
    expect(snapshot).toMatchObject({
      kind: 'complete',
      origin: 'pull',
      versionId: 'received-v2',
      sha: s.sha,
      facts: [],
    })
  } finally {
    s.p.close()
  }
})
it.each([true, false])(
  'a received link (resolved=%s) plus an ordinary edit never proposes a question',
  async (resolved) => {
    const s = await setup()
    try {
      const source = '[[private.png]]',
        sha = await sha256(new TextEncoder().encode(source))
      const app = (s.p as any).options.app
      app.metadataCache.getFirstLinkpathDest = () =>
        resolved ? { path: 'Assets/private.png' } : null
      const cache = {
        links: [
          {
            link: 'private.png',
            original: source,
            position: { start: { offset: 0 }, end: { offset: source.length } },
          },
        ],
      }
      const entry = {
        path: 'Received.md',
        wirePath: 'Received.md',
        fileId: s.event.fileId,
        versionId: s.event.versionId,
        sha,
        size: source.length,
        mtime: 1,
      }
      vi.mocked(s.state.byFileId).mockResolvedValue(entry)
      s.events.get('changed')!({ path: entry.path }, source, cache)
      await s.p.flush()
      await s.p.hooks.onPersonalNoteApplied(
        { ...s.event, sha, size: source.length },
        new TextEncoder().encode(source)
      )
      await s.state.put({
        path: 'Assets/private.png',
        wirePath: 'Assets/private.png',
        fileId: 'private-id',
        versionId: 'private-v1',
        sha: 'a'.repeat(64),
        size: 1,
        mtime: 1,
      })
      app.metadataCache.getFirstLinkpathDest = () => ({ path: 'Assets/private.png' })
      const edited = source + '\nordinary body edit',
        editedSha = await sha256(new TextEncoder().encode(edited))
      s.events.get('changed')!({ path: entry.path }, edited, cache)
      await s.p.flush()
      const op = {
        op: 'update',
        file_id: entry.fileId,
        base_version_id: entry.versionId,
        sha: editedSha,
        size: edited.length,
        mtime: 2,
      }
      await s.p.hooks.beforeUpload!({
        operations: [{ op, index: 0, handle: 'sample-handle' }],
        idempotencyKey: 'sample-request',
      } as any)
      await s.p.hooks.onSettled!(
        {
          op,
          fileId: entry.fileId,
          versionId: 'edited-v3',
          path: entry.path,
          sha: editedSha,
          handle: 'sample-handle',
          result: { status: 'applied' },
        } as any,
        new TextEncoder().encode(edited),
        'sample-request'
      )
      expect(await (s.p as any).read('existing-candidates')).toBeNull()
    } finally {
      s.p.close()
    }
  }
)
it.each(['applied', 'merged'])(
  'compares saved local facts before %s settlement, not merged facts',
  async (status) => {
    const s = await setup()
    try {
      await s.p.hooks.onPersonalNoteApplied(s.event, s.bytes)
      await s.state.put({
        path: 'Assets/private.png',
        wirePath: 'Assets/private.png',
        fileId: 'private-id',
        versionId: 'private-v1',
        sha: 'a'.repeat(64),
        size: 1,
        mtime: 1,
      })
      const app = (s.p as any).options.app
      app.metadataCache.getFirstLinkpathDest = () => ({ path: 'Assets/private.png' })
      const source = '[[private.png]]',
        sha = await sha256(new TextEncoder().encode(source))
      const cache = {
        links: [
          {
            link: 'private.png',
            original: source,
            position: { start: { offset: 0 }, end: { offset: source.length } },
          },
        ],
      }
      s.events.get('changed')!({ path: 'Received.md' }, source, cache)
      await s.p.flush()
      const op = {
        op: 'update',
        file_id: s.event.fileId,
        base_version_id: s.event.versionId,
        sha,
        size: source.length,
        mtime: 2,
      }
      await s.p.hooks.beforeUpload!({
        operations: [{ op, index: 0, handle: 'sample-handle' }],
        idempotencyKey: 'sample-request',
      } as any)
      // The merge may contain someone else's newly received link: do not count it as local.
      const merged = source + '\n[[received.png]]'
      app.metadataCache.getFirstLinkpathDest = (link: string) => ({
        path: link === 'received.png' ? 'received.png' : 'Assets/private.png',
      })
      await s.state.put({
        path: 'received.png',
        wirePath: 'received.png',
        fileId: 'received-asset',
        versionId: 'asset-v1',
        sha: 'b'.repeat(64),
        size: 1,
        mtime: 1,
      })
      const settledSource = status === 'merged' ? merged : source
      const settledSha = await sha256(new TextEncoder().encode(settledSource))
      s.events.get('changed')!(
        { path: 'Received.md' },
        settledSource,
        status === 'merged'
          ? {
              links: [
                ...cache.links,
                {
                  link: 'received.png',
                  original: '[[received.png]]',
                  position: {
                    start: { offset: source.length + 1 },
                    end: { offset: merged.length },
                  },
                },
              ],
            }
          : cache
      )
      await s.p.flush()
      await s.p.hooks.onSettled!(
        {
          op,
          fileId: s.event.fileId,
          versionId: 'local-v3',
          path: 'Received.md',
          sha: settledSha,
          handle: 'sample-handle',
          result: { status },
        } as any,
        new TextEncoder().encode(settledSource),
        'sample-request'
      )
      expect(await (s.p as any).read('existing-candidates')).toEqual([
        { sponsorId: s.event.fileId, targetId: 'private-id', targetPath: 'Assets/private.png' },
      ])
      expect(await (s.p as any).snapshots.get(s.event.fileId)).toMatchObject({
        kind: 'complete',
        versionId: 'local-v3',
      })
    } finally {
      s.p.close()
    }
  }
)
it('a mismatched received delivery cannot certify a baseline', async () => {
  const s = await setup()
  try {
    await expect(
      (s.p.hooks as any).onPersonalNoteApplied({ ...s.event, versionId: 'wrong-version' }, s.bytes)
    ).rejects.toThrow(/delivery|personal version/)
    expect(await (s.p as any).snapshots.get(s.event.fileId)).toMatchObject({ kind: 'unknown' })
  } finally {
    s.p.close()
  }
})
