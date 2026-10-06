import type { ExistingPublicationQuestion } from '@/sync/publication/publicationDecision'
/** Presentation-only fixture: no consent, credentials, storage or HTTP operation. */
export const publicationQuestion: ExistingPublicationQuestion = {
  exposureKey: 'a'.repeat(64),
  fingerprint: 'b'.repeat(64),
  observation: {
    binding: {
      localVault: 'sample-local',
      issuer: 'https://sync.example',
      vaultId: 'sample-vault',
      principal: 'sample-owner',
      facet: 'personal',
      grantId: null,
    },
    target: {
      fileId: 'sample-target',
      versionId: 'sample-version',
      sha: 'c'.repeat(64),
      path: 'Assets/a-long-sample-private-attachment.png',
      eligible: true,
    },
    sponsor: {
      fileId: 'sample-note',
      versionId: 'note-v1',
      path: 'Shared/sample-note.md',
      admissionGeneration: 1,
      intrinsic: true,
      inScope: true,
    },
    audience: {
      grantId: 'sample-grant',
      label: 'Sample collaborators with a long audience label',
      active: true,
      alreadyShared: false,
      revision: 0,
      withdrawalGeneration: 0,
    },
    linked: true,
  },
}
