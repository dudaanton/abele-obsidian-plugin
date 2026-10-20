import { vi } from 'vitest'
import { MemoryFileSystem, MemoryStateStore } from '@abele/sync-sdk/core'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { PathCoordinator, coordinatedFileSystem } from '@/sync/pathCoordinator'
export async function tokenPublicationFixture(allow = true) {
  const source = {
    id: 'sample-connection',
    address: 'https://sync.example',
    spaceId: 'sample-space',
    tokenId: 'sample-token',
    scope: { kind: 'group' as const, id: 'sample-group', path: 'Groups/sample.md' },
  }
  const state = new MemoryStateStore(),
    metadata = new MemoryStateStore(),
    files = new MemoryFileSystem(),
    locks = new PathCoordinator()
  const targets = new Map(
    ['first', 'second'].map((id) => [id, { id, path: id + '.bin', kind: 'attachment' as const }])
  )
  for (const target of targets.values())
    await files.writeAtomic(
      target.path,
      new TextEncoder().encode(target.id + ' immutable bytes'),
      1000
    )
  const reviews = {
    executables: new ExecutableReview(metadata),
    attachments: new AttachmentConsent(metadata),
    close: () => {},
  }
  const wire = vi.fn<typeof fetch>(async (input) => {
    const route = new URL(String(input)).pathname
    if (route === '/v2/connection')
      return Response.json({
        protocol: 2,
        token_id: source.tokenId,
        space_id: source.spaceId,
        scope: source.scope,
        status: 'active',
        limits: { max_file_bytes: 1000000, quota_bytes: null },
      })
    if (route === '/v2/manifest') return Response.json({ items: [], cursor: 0, next: null })
    if (route === '/v2/changes') return Response.json({ items: [], cursor: 0, next: null })
    throw new Error('Unexpected fixture route: ' + route)
  })
  const make = () =>
    new TokenEngineRuntime({
      id: source.id,
      encoded: encodeAccessToken({
        v: 1,
        address: source.address,
        key: 'a'.repeat(43),
        scope: source.scope,
      }),
      fs: coordinatedFileSystem(files, locks),
      state,
      reviews,
      fetch: wire,
      changed: () => {},
      failed: () => {},
      covers: async () => false,
      localFiles: { note: async () => null, resolve: (id) => targets.get(id) ?? null },
    })
  const runtime = make()
  await runtime.sync()
  await reviews.attachments.observeNote(source, 'sample-note', [...targets.keys()])
  for (const question of await reviews.attachments.noteOpened(source, 'sample-note', runtime))
    await reviews.attachments.decide(question.id, allow, runtime)
  const publish = vi
    .spyOn(runtime.client, 'publishGroupAsset')
    .mockImplementation(async (path, bytes, mtime) => ({
      cursor: 1,
      results: [
        {
          status: 'applied',
          file_id: 'file-' + path,
          version_id: 'version-' + path,
          path,
          sha: await (await import('@abele/sync-sdk/core')).sha256(bytes),
          size: bytes.length,
          mtime,
          seq: 1,
        },
      ],
    }))
  return { runtime, make, publish, files, state, metadata, reviews, source, targets, wire, locks }
}
