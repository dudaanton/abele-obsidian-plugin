// @vitest-environment node
import { it, expect, vi } from 'vitest'
import { MemoryStateStore } from '@abele/sync-core'
import { NativeOwnerPublication } from '@/sync/publication/nativeOwnerPublication'
import { publicationFixture } from '../helpers/publicationFixture'
import { buildFakeVault } from '../helpers/fakeVault'
it('persists the exact sending subset and ready intent before a partial hold can permit upload', async () => {
  const input = await publicationFixture(),
    app = buildFakeVault([]),
    meta = new MemoryStateStore(),
    state = new MemoryStateStore()
  ;(app.metadataCache as any).on = () => ({})
  ;(app.metadataCache as any).offref = () => {}
  ;(app.vault.adapter as any).read = async () => input.current.facts[0].original
  const p = new NativeOwnerPublication({
    app: app as any,
    meta,
    state,
    client: { commitRaw: vi.fn() } as any,
    binding: input.binding,
    grants: ['sample-grant'],
    token: () => 'absd_' + 'a'.repeat(43),
    fetch: vi.fn() as any,
    configurationRoots: () => ['.obsidian', 'Scripts'],
    enabled: () => true,
    held: () => true,
    eventTarget: { addEventListener: () => {}, removeEventListener: () => {} } as any,
  })
  await p.start(true)
  const internal = p as any,
    source = input.current.facts[0].original
  internal.assets.read = vi.fn(async () => ({
    grantId: 'sample-grant',
    active: true,
    revision: 0,
    withdrawalGeneration: 0,
    entries: [],
  }))
  internal.assets.sponsorProof = vi.fn(async () => ({
    fileId: 'sample-note',
    versionId: 'pending-note',
    admissionGeneration: 7,
    inScope: true,
    intrinsic: true,
  }))
  internal.pastes = [
    {
      id: 'sample-introduction',
      notePath: 'NoteA.md',
      before: '',
      start: 0,
      end: 0,
      epoch: 0,
      clipSha: input.target.sha,
      assetSha: input.target.sha,
      assetPath: input.target.path,
      baseline: input.baseline,
      current: {
        path: 'NoteA.md',
        source,
        sha: input.current.sha,
        cacheSha: input.current.evidence.cacheSha,
        cacheJson: input.current.evidence.cacheJson,
        generation: input.current.evidence.generation,
        facts: input.current.facts,
      },
      sponsor: { fileId: 'sample-note', versionId: 'pending-note', sha: input.current.sha },
    },
    {
      id: 'sample-waiting',
      notePath: 'NoteB.md',
      before: '',
      start: 0,
      end: 0,
      epoch: 0,
      assetSha: 'b'.repeat(64),
      assetPath: 'Assets/waiting.png',
      baseline: input.baseline,
    },
  ]
  const ops = [
      { op: 'create', path: input.target.path, sha: input.target.sha, size: 1, mtime: 1 },
      { op: 'create', path: 'Assets/waiting.png', sha: 'b'.repeat(64), size: 1, mtime: 1 },
      { op: 'create', path: 'NoteB.md', sha: 'c'.repeat(64), size: 1, mtime: 1 },
    ],
    unit = {
      batchId: 'sample-batch',
      idempotencyKey: 'sample-request',
      ops,
      operations: ops.map((op, index) => ({ op, index, handle: 'sample-batch:' + index })),
    }
  const prepare = vi.spyOn(internal.intents, 'prepare')
  expect(await p.hooks.beforeUpload!(unit as any)).toEqual({ holdIndices: [1] })
  expect(prepare).toHaveBeenCalledOnce()
  expect(prepare.mock.calls[0][0]).toMatchObject({
    requestId: 'sample-request',
    ops: [ops[0], ops[2]],
    createHandles: { 0: 'sample-batch:0', 1: 'sample-batch:2' },
  })
  const row = await internal.read('unit:sample-request')
  expect(row.ops).toEqual([ops[0], ops[2]])
  expect((await internal.intents.read()).units).toHaveLength(1)
  p.close()
})
