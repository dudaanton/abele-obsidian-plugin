import { describe, expect, it } from 'vitest'
import {
  reducePublication,
  answerPublication,
  PublicationDecisionStore,
  type PublicationInput,
} from '@/sync/publication/publicationDecision'
import type { CompleteSnapshot, LinkFact } from '@/sync/publication/LinkSnapshotStore'
const binding = {
  localVault: 'sample-local',
  issuer: 'https://sync.example',
  vaultId: 'sample-vault',
  principal: 'sample-device',
  facet: 'personal' as const,
  grantId: null,
}
const link = (path = 'Assets/sample.png', id: string | null = 'sample-asset'): LinkFact => ({
  kind: 'embed',
  spelling: path,
  original: '![[sample]]',
  start: 0,
  end: 11,
  resolvedPath: path,
  targetId: id,
  resolution: 'resolved',
  provenance: {
    linkId: 'sample-owner-link:' + path,
    origin: 'owner-added',
    noteId: 'sample-note',
    sourceSha: 'b'.repeat(64),
    cacheGeneration: 'current',
    proofId: 'sample-owner-add-event',
  },
})
const snapshot = (version: string, facts: LinkFact[]): CompleteSnapshot => ({
  kind: 'complete',
  binding,
  noteId: 'sample-note',
  versionId: version,
  sha: 'b'.repeat(64),
  origin: 'pull',
  facts,
  evidence: {
    adapter: 'fixture',
    runtime: 'fixture',
    generation: version,
    noteId: 'sample-note',
    versionId: version,
    sourceSha: 'b'.repeat(64),
    cacheSha: 'c'.repeat(64),
    cacheJson: '{}',
    complete: true,
  },
})
function input(): PublicationInput {
  return {
    binding,
    baseline: snapshot('base', []),
    current: snapshot('current', [link()]),
    owner: {
      kind: 'owner-edit',
      noteId: 'sample-note',
      sourceSha: 'b'.repeat(64),
      cacheGeneration: 'current',
      baseVersionId: 'base',
    },
    target: {
      id: 'sample-asset',
      path: 'Assets/sample.png',
      sha: 'a'.repeat(64),
      versionId: 'asset-v1',
      security: 'eligible',
      creator: 'existing-private',
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
function pending(i: PublicationInput) {
  i.target = {
    ...i.target,
    id: null,
    versionId: null,
    creator: 'pending-local-create',
    create: {
      handle: 'sample-create',
      installation: 'sample-local',
      pending: true,
      hasLedgerIdentity: false,
    },
  }
  i.current.facts[0].targetId = null
}
describe('disabled owner publication decision contracts', () => {
  it.each([false, true])(
    'does not launder a foreign unresolved link through a note move and unrelated owner edit (pending=%s)',
    async (isPending) => {
      const i = input()
      i.baseline = snapshot('base', [
        { ...link('../Assets/private.png', null), resolvedPath: null, resolution: 'unresolved' },
      ])
      i.target.path = 'Assets/private.png'
      i.current.facts = [{ ...link('Assets/private.png'), spelling: '../../Assets/private.png' }]
      if (isPending) pending(i)
      i.knownRenames.items = [
        { fileId: 'sample-note', from: 'Notes/shared.md', to: 'Shared/deep/shared.md' },
      ]
      // The note edit is genuine, but this individual link is still recipient-introduced.
      i.current.facts[0].provenance = {
        linkId: 'incoming-link',
        origin: 'automatic-rewrite',
        noteId: 'sample-note',
        sourceSha: i.current.sha,
        cacheGeneration: 'current',
        proofId: 'received-link-proof',
      }
      expect((await reducePublication(i)).kind).toBe('hold')
    }
  )
  it('holds missing per-link lineage rather than inferring it from an owner body edit', async () => {
    const i = input()
    delete i.current.facts[0].provenance
    expect((await reducePublication(i)).kind).toBe('hold')
  })
  it('invalidates a prompt when its individual owner-add event changes', async () => {
    const i = input(),
      proposal = await reducePublication(i)
    if (proposal.kind !== 'confirm') throw new Error('Expected confirmation')
    const changed = input()
    changed.current.facts[0].provenance!.proofId = 'other-owner-add-event'
    expect((await answerPublication(proposal, changed, true)).kind).toBe('hold')
  })
  it('requires one exact existing-private exposure confirmation, never a password', async () => {
    const out = await reducePublication(input())
    expect(out.kind).toBe('confirm')
    if (out.kind === 'confirm') {
      expect(out.audiences).toEqual(['sample-grant'])
      expect(out.sponsors).toEqual(['sample-note'])
      expect(out.requiresPassword).toBe(false)
    }
  })
  it('creates a pre-upload intent for a proven pending local create, not a direct publication', async () => {
    const i = input()
    pending(i)
    expect(await reducePublication(i)).toMatchObject({
      kind: 'auto-intent',
      mustPersistBeforeUpload: true,
      targetRef: 'create:sample-create',
    })
  })
  it('keeps planted unresolved spelling old when it resolves later', async () => {
    const i = input()
    i.baseline = snapshot('base', [
      { ...link(), resolvedPath: null, targetId: null, resolution: 'unresolved' },
    ])
    expect(await reducePublication(i)).toMatchObject({
      kind: 'none',
      reason: 'link or target already in baseline',
    })
  })
  it('does not prompt for a changed spelling reaching a known renamed private identity', async () => {
    const i = input()
    i.baseline = snapshot('base', [link('Assets/old.png')])
    i.knownRenames.items = [
      { fileId: 'sample-asset', from: 'Assets/old.png', to: 'Assets/sample.png' },
    ]
    expect((await reducePublication(i)).kind).toBe('none')
  })
  it('tracks a known rename even when baseline target identity was not yet resolved', async () => {
    const i = input()
    i.baseline = snapshot('base', [link('Assets/old.png', null)])
    i.knownRenames.items = [
      { fileId: 'sample-asset', from: 'Assets/old.png', to: 'Assets/sample.png' },
    ]
    expect((await reducePublication(i)).kind).toBe('none')
  })
  it.each(['received', 'restore', 'merge', 'linter', 'rename-rewrite', 'unknown'] as const)(
    'never launders %s as an owner addition',
    async (kind) => {
      const i = input()
      i.owner.kind = kind
      expect((await reducePublication(i)).kind).toBe('hold')
    }
  )
  it('holds missing baseline, ambiguous resolution and incomplete rename evidence', async () => {
    const i = input()
    i.baseline = { kind: 'unknown', noteId: 'sample-note', reason: 'missing' }
    expect((await reducePublication(i)).kind).toBe('hold')
    const j = input()
    j.current.facts[0].resolution = 'ambiguous'
    expect((await reducePublication(j)).kind).toBe('hold')
    const k = input()
    k.knownRenames.complete = false
    expect((await reducePublication(k)).kind).toBe('hold')
  })
  it('requires baseline cache identity and completeness, not just its version label', async () => {
    const i = input()
    if (i.baseline.kind !== 'complete') throw new Error('Expected baseline')
    i.baseline.evidence.sourceSha = 'd'.repeat(64)
    expect((await reducePublication(i)).kind).toBe('hold')
  })
  it('supports only a durable genuinely local new-note empty base', async () => {
    const i = input()
    pending(i)
    i.owner.kind = 'owner-create'
    i.owner.baseVersionId = null
    i.owner.baseCreateHandle = 'new-note-handle'
    i.baseline = {
      kind: 'local-create',
      binding,
      noteId: 'sample-note',
      handle: 'new-note-handle',
      pending: true,
      hasLedgerIdentity: false,
    }
    expect((await reducePublication(i)).kind).toBe('auto-intent')
    i.baseline.hasLedgerIdentity = true
    expect((await reducePublication(i)).kind).toBe('hold')
  })
  it('requires current evidence and exact connection/base/generation provenance', async () => {
    for (const mutate of [
      (i: PublicationInput) => {
        i.owner.cacheGeneration = 'older'
      },
      (i: PublicationInput) => {
        i.owner.baseVersionId = 'other'
      },
      (i: PublicationInput) => {
        i.current.binding = { ...binding, principal: 'other' }
      },
      (i: PublicationInput) => {
        i.current.evidence.complete = false
      },
    ]) {
      const i = input()
      mutate(i)
      expect((await reducePublication(i)).kind).toBe('hold')
    }
  })
  it.each(['script', 'settings', 'unknown'] as const)(
    'never admits %s targets including renamed known code',
    async (security) => {
      const i = input()
      i.target.security = security
      expect(['refuse', 'hold']).toContain((await reducePublication(i)).kind)
    }
  )
  it('holds pending creates that already settled/adopted or have another creator', async () => {
    for (const creator of ['received', 'restored', 'renamed', 'unknown'] as const) {
      const i = input()
      i.target.creator = creator
      expect((await reducePublication(i)).kind).toBe('hold')
    }
    const i = input()
    pending(i)
    i.target.create!.hasLedgerIdentity = true
    expect((await reducePublication(i)).kind).toBe('hold')
  })
  it('does not infer identity from identical bytes of a genuinely new deliberate duplicate', async () => {
    const i = input()
    pending(i)
    i.target.path = 'Assets/new-copy.png'
    i.current.facts = [link(i.target.path, null)]
    i.baseline = snapshot('base', [link('Assets/original.png', 'old-asset')])
    expect((await reducePublication(i)).kind).toBe('auto-intent')
  })
  it('refuses withdrawal/revoked sponsor and never overrides them with an old approval', async () => {
    const i = input()
    i.audiences[0].withdrawn = true
    expect((await reducePublication(i)).kind).toBe('hold')
    const j = input()
    j.audiences[0].active = false
    expect((await reducePublication(j)).kind).toBe('hold')
  })
  it('adds a sponsor without prompting only for already-shared exact audience', async () => {
    const i = input()
    i.audiences[0].alreadyShared = true
    expect((await reducePublication(i)).kind).toBe('sponsor-intent')
    i.audiences.push({ ...i.audiences[0], grantId: 'additional-grant', alreadyShared: false })
    expect(await reducePublication(i)).toMatchObject({
      kind: 'confirm',
      audiences: ['additional-grant', 'sample-grant'],
    })
  })
  it('declines persist through reload and ordinary resaves without repeated prompts', async () => {
    const values = new Map<string, string>(),
      meta = {
        getMeta: (k: string) => values.get(k) ?? null,
        setMeta: (k: string, v: string | null) => {
          if (v === null) values.delete(k)
          else values.set(k, v)
        },
      }
    const i = input(),
      proposal = await reducePublication(i)
    if (proposal.kind !== 'confirm') throw new Error('Expected confirmation')
    const store = new PublicationDecisionStore(meta)
    await store.remember(proposal, 'declined')
    i.decisions = [(await new PublicationDecisionStore(meta).get(proposal.exposureKey))!]
    i.current.sha = 'd'.repeat(64)
    i.current.evidence.sourceSha = i.current.sha
    i.owner.sourceSha = i.current.sha
    expect((await reducePublication(i)).kind).toBe('hold')
  })
  it('invalidates a changed cache attestation even when source SHA and generation labels match', async () => {
    const i = input(),
      p = await reducePublication(i)
    if (p.kind !== 'confirm') throw new Error('Expected confirmation')
    const changed = input()
    changed.current.evidence.cacheSha = 'e'.repeat(64)
    expect((await answerPublication(p, changed, true)).kind).toBe('hold')
  })
  it('invalidates an open confirmation on target identity/version or audience changes', async () => {
    const i = input(),
      p = await reducePublication(i)
    if (p.kind !== 'confirm') throw new Error('Expected confirmation')
    for (const mutate of [
      (j: PublicationInput) => {
        j.target.id = 'replacement'
      },
      (j: PublicationInput) => {
        j.target.versionId = 'asset-v2'
      },
      (j: PublicationInput) => {
        j.audiences[0].withdrawalGeneration++
      },
    ]) {
      const j = input()
      mutate(j)
      expect((await answerPublication(p, j, true)).kind).toBe('hold')
    }
    expect((await answerPublication(p, input(), true)).kind).toBe('confirmed-intent')
  })
  it('reports only a deduplicated local count when authorized availability evidence is complete', async () => {
    const i = input()
    i.availableTargetIds = []
    i.current.facts.push({ ...i.current.facts[0] })
    const result = await reducePublication(i)
    // The eligible new link still needs confirmation; counts do not create authority.
    expect(result.kind).toBe('confirm')
    i.owner.kind = 'received'
    expect(await reducePublication(i)).toMatchObject({
      missingReferences: { known: true, count: 1 },
    })
    i.current.evidence.complete = false
    expect(await reducePublication(i)).toMatchObject({ missingReferences: { known: false } })
  })
  it('provides only a local missing-reference count on scoped connections, never private metadata', async () => {
    const i = input()
    i.binding = { ...binding, facet: 'scoped', grantId: 'sample-grant' }
    const out = await reducePublication(i)
    expect(out).not.toHaveProperty('target')
    expect(out).not.toHaveProperty('targetRef')
    expect(out.kind).toBe('refuse')
  })
})
