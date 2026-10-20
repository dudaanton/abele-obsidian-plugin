import { expect, it, vi } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { ExternalState } from '@/sync/external/state'
import { ExternalRepresentation } from '@/sync/external/representation'
import { serializeProjection } from '@/sync/external/projection'
import { externalFileFixture as fixture } from './externalFileFollowupFixture'
it.each([
  ['png', 'image/png'],
  ['PNG', 'image/png'],
  ['custom', 'application/octet-stream'],
  ['constructor', 'application/octet-stream'],
  ['__proto__', 'application/octet-stream'],
  ['pdf', 'application/pdf'],
  ['mp4', 'video/mp4'],
  ['m4a', 'audio/mp4'],
  ['epub', 'application/epub+zip'],
])('records the real extension type of an offloaded %s', async (extension, mime) => {
  const s = await fixture(`Media/sample.${extension}`)
  try {
    expect((await s.port.evict(s.path)).status).toBe('complete')
    expect(JSON.parse(await s.app.vault.adapter.read(s.path + '.abele-ref')).mime).toBe(mime)
  } finally {
    s.close()
  }
})

it('resumes a previously journalled generic-MIME projection without changing its immutable digest', async () => {
  const s = await fixture('Media/sample.png')
  try {
    await s.port.evict(s.path)
    const doc = JSON.parse((await s.state.getExternalState())!)
    const file = doc.files[0],
      old = doc.operations[0]
    const versionId = 'sample-next-version'
    const legacy = serializeProjection({
      format: 'abele.external',
      schema: 1,
      vaultId: s.binding.vaultId,
      fileId: s.head.fileId,
      path: s.path,
      observedVersionId: versionId,
      sha256: s.head.sha,
      size: s.head.size,
      mime: 'application/octet-stream',
      mtime: 2000,
    })
    const digest = await sha256(legacy),
      operationId = 'sample-legacy-projection'
    const operation = {
      ...old,
      operationId,
      kind: 'projection-update',
      phase: 'held',
      revision: 0,
      expected: { ...old.expected, versionId },
      previousRepresentation: 'remote-only',
      sourcePath: file.projectionPath,
      targetPath: file.projectionPath,
      projectionDigest: digest,
      ownedArtifacts: [
        {
          operationId,
          path: 'Media/.abele-external-sample-legacy-projection.incoming',
          sha: digest,
          size: legacy.length,
          role: 'projection',
        },
      ],
      unresolvedOutcome: 'verification-unavailable',
      cleanupReason: null,
    }
    // Seed a document written by the earlier format, before this runtime opens it.
    await s.state.commitExternalPhase({
      expectedRevision: doc.revision,
      next: JSON.stringify({
        ...doc,
        revision: doc.revision + 1,
        files: [
          { ...file, localRevision: file.localRevision + 1, pendingOperationId: operationId },
        ],
        operations: [...doc.operations, operation],
      }),
    })
    await s.state.put({ ...s.head, versionId, mtime: 2000 })
    const install = vi.fn(async (_path: string, bytes: Uint8Array) => {
      expect(await sha256(bytes)).toBe(digest)
      expect(JSON.parse(new TextDecoder().decode(bytes)).mime).toBe('application/octet-stream')
      return 'cleanup-pending' as const
    })
    const runtime = await ExternalRepresentation.open({
      state: await ExternalState.open(s.state, doc.ledgerId, s.binding),
      ledger: s.state,
      fs: s.fs,
      verify: async (file_id, request) => ({ file_id, ...request, verified: true }),
      assertOwned: () => {},
      scriptsFolder: () => 'Scripts',
      installProjection: install,
    })
    await runtime.recoverJobs()
    expect(install).toHaveBeenCalledOnce()
  } finally {
    s.close()
  }
})
