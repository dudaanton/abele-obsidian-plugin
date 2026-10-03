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
