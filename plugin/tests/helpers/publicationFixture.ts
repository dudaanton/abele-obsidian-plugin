import { sha256 } from '@abele/sync-core'
import type { PublicationInput } from '@/sync/publication/publicationDecision'
export async function publicationFixture(pending = true): Promise<PublicationInput> {
  const source = '![[Assets/sample.png]]',
    sha = await sha256(new TextEncoder().encode(source)),
    cacheJson = '{"sample":true}',
    cacheSha = await sha256(new TextEncoder().encode(cacheJson))
  const binding = {
    localVault: 'sample-local',
    issuer: 'https://sync.example',
    vaultId: 'sample-vault',
    principal: 'sample-owner',
    facet: 'personal' as const,
    grantId: null,
  }
  const evidence = {
    adapter: 'fixture',
    runtime: 'fixture',
    generation: 'sample-generation',
    noteId: 'sample-note',
    versionId: 'pending-note',
    sourceSha: sha,
    cacheSha,
    cacheJson,
    complete: true,
  }
  return {
    binding,
    baseline: {
      kind: 'complete',
      binding,
      noteId: 'sample-note',
      versionId: 'base-note',
      sha,
      origin: 'pull',
      facts: [],
      evidence: { ...evidence, versionId: 'base-note' },
    },
    current: {
      kind: 'complete',
      binding,
      noteId: 'sample-note',
      versionId: 'pending-note',
      sha,
      origin: 'push',
      evidence,
      facts: [
        {
          kind: 'embed',
          spelling: 'Assets/sample.png',
          original: source,
          start: 0,
          end: source.length,
          resolvedPath: 'Assets/sample.png',
          targetId: pending ? null : 'sample-asset',
          resolution: 'resolved',
          provenance: {
            linkId: 'sample-link',
            origin: 'owner-added',
            noteId: 'sample-note',
            sourceSha: sha,
            cacheGeneration: 'sample-generation',
            proofId: 'sample-introduction',
          },
        },
      ],
    },
    owner: {
      kind: 'owner-edit',
      noteId: 'sample-note',
      sourceSha: sha,
      cacheGeneration: 'sample-generation',
      baseVersionId: 'base-note',
    },
    target: {
      id: pending ? null : 'sample-asset',
      path: 'Assets/sample.png',
      sha: 'a'.repeat(64),
      versionId: pending ? null : 'asset-v1',
      security: 'eligible',
      creator: pending ? 'pending-local-create' : 'existing-private',
      ...(pending
        ? {
            create: {
              handle: 'sample-create',
              installation: 'sample-local',
              pending: true,
              hasLedgerIdentity: false,
            },
          }
        : {}),
    },
    audiences: [
      {
        grantId: 'sample-grant',
        active: true,
        sponsorId: 'sample-note',
        admissionGeneration: 1,
        publicationGeneration: 0,
        withdrawalGeneration: 0,
        alreadyShared: false,
        withdrawn: false,
      },
    ],
    knownRenames: { complete: true, items: [] },
    decisions: [],
  }
}
