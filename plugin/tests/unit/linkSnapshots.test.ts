import { describe, expect, it } from 'vitest'
import {
  LinkSnapshotStore,
  type SnapshotCandidate,
  type SnapshotBinding,
} from '@/sync/publication/LinkSnapshotStore'
import { sha256 } from '@abele/sync-core'
import { existingPrivateTargets } from '@/sync/publication/existingPrivateConfirmation'
import { PUBLICATION_ENABLED, assertPublicationEnabled } from '@/sync/publication/fence'
const binding: SnapshotBinding = {
  localVault: 'sample-local',
  issuer: 'https://sync.example',
  vaultId: 'sample-vault',
  principal: 'sample-device',
  facet: 'personal',
  grantId: null,
}
const meta = () => {
  const values = new Map<string, string>()
  return {
    getMeta: async (key: string) => values.get(key) ?? null,
    setMeta: async (key: string, value: string | null) => {
      if (value === null) values.delete(key)
      else values.set(key, value)
    },
  }
}
async function candidate(source = '[[sample.png]]'): Promise<SnapshotCandidate> {
  const cacheJson = JSON.stringify({ links: [{ link: 'sample.png', original: source }] })
  return {
    noteId: 'sample-note',
    versionId: 'sample-version',
    source,
    origin: 'pull',
    facts: [
      {
        kind: 'link',
        spelling: 'sample.png',
        original: source,
        start: 0,
        end: source.length,
        resolvedPath: 'Assets/sample.png',
        targetId: 'sample-asset',
        resolution: 'resolved',
      },
    ],
    evidence: {
      adapter: 'fixture-version-v1',
      runtime: 'fixture',
      generation: '1',
      noteId: 'sample-note',
      versionId: 'sample-version',
      sourceSha: await sha256(new TextEncoder().encode(source)),
      cacheSha: await sha256(new TextEncoder().encode(cacheJson)),
      cacheJson,
      complete: true,
    },
  }
}
describe('existing-private version comparison', () => {
  it('asks for an own new resolved target without link-level provenance', async () => {
    const c = await candidate(),
      store = new LinkSnapshotStore(meta(), binding, () => true)
    const base = await store.settle({
      ...c,
      source: '',
      facts: [],
      evidence: { ...c.evidence, sourceSha: await sha256(new Uint8Array()) },
    })
    expect(existingPrivateTargets(base, c.facts, [])).toEqual(c.facts)
  })
  it('never asks for received spellings that later resolve, or an identity-preserving rename', async () => {
    const c = await candidate(),
      store = new LinkSnapshotStore(meta(), binding, () => true)
    const unresolved = {
      ...c.facts[0],
      targetId: null,
      resolvedPath: null,
      resolution: 'unresolved' as const,
    }
    const base = await store.settle({ ...c, facts: [unresolved] })
    expect(existingPrivateTargets(base, c.facts, [])).toEqual([])
    const resolvedBase = await store.settle(c)
    const renamed = { ...c.facts[0], spelling: 'renamed.png', resolvedPath: 'Assets/renamed.png' }
    expect(existingPrivateTargets(resolvedBase, [renamed], [])).toEqual([])
    expect(
      existingPrivateTargets(
        base,
        [renamed],
        [{ fileId: 'sample-asset', from: 'sample.png', to: 'Assets/renamed.png' }]
      )
    ).toEqual([])
  })
  it('compares only submitted local facts, never the received half of a merge', async () => {
    const c = await candidate(),
      store = new LinkSnapshotStore(meta(), binding, () => true)
    const base = await store.settle(c)
    expect(existingPrivateTargets(base, c.facts, [])).toEqual([])
    expect(
      existingPrivateTargets(
        { kind: 'unknown', noteId: c.noteId, reason: 'lost cache' },
        c.facts,
        []
      )
    ).toEqual([])
  })
})
describe('durable exact-version link snapshots', () => {
  it('is disabled independently of stored facts and accepts only an attested producer', async () => {
    expect(PUBLICATION_ENABLED).toBe(false)
    expect(assertPublicationEnabled).toThrow(/disabled/)
    const store = new LinkSnapshotStore(meta(), binding, () => false)
    expect((await store.settle(await candidate())).kind).toBe('unknown')
  })
  it('copies a pull baseline and never replaces it with a later current-file cache', async () => {
    const persistence = meta(),
      store = new LinkSnapshotStore(persistence, binding, () => true)
    const input = await candidate()
    const accepted = await store.settle(input)
    expect(accepted.kind).toBe('complete')
    input.facts[0].targetId = 'mutated'
    input.evidence.generation = 'later'
    const reopened = new LinkSnapshotStore(persistence, binding, () => true)
    expect(await reopened.get('sample-note')).toMatchObject({
      kind: 'complete',
      versionId: 'sample-version',
      facts: [{ targetId: 'sample-asset' }],
      evidence: { generation: '1' },
    })
    await reopened.rename('sample-asset', 'Assets/sample.png', 'Assets/renamed.png')
    expect(((await reopened.get('sample-note')) as any).facts[0].resolvedPath).toBe(
      'Assets/sample.png'
    )
    expect(await reopened.renames()).toEqual({
      complete: true,
      items: [{ fileId: 'sample-asset', from: 'Assets/sample.png', to: 'Assets/renamed.png' }],
    })
  })
  it.each(['sourceSha', 'versionId', 'generation', 'cacheSha'] as const)(
    'records unknown, not stale complete facts, on invalid %s evidence',
    async (field) => {
      const input = await candidate()
      input.evidence[field] = 'stale'
      const store = new LinkSnapshotStore(
        meta(),
        binding,
        (evidence) => evidence.evidence.generation === '1'
      )
      expect((await store.settle(input)).kind).toBe('unknown')
      expect((await store.get(input.noteId)).kind).toBe('unknown')
    }
  )
  it('requires complete offsets and no ambiguous resolution', async () => {
    const store = new LinkSnapshotStore(meta(), binding, () => true),
      input = await candidate()
    input.facts[0].end--
    expect((await store.settle(input)).kind).toBe('unknown')
    const ambiguous = await candidate()
    ambiguous.facts[0].resolution = 'ambiguous'
    expect((await store.settle(ambiguous)).kind).toBe('unknown')
  })
  it('holds missing baselines and binds every local/issuer/principal/facet/grant identity', async () => {
    const p = meta(),
      store = new LinkSnapshotStore(p, binding, () => true)
    expect(await store.get('sample-note')).toMatchObject({
      kind: 'unknown',
      reason: 'missing baseline',
    })
    await store.settle(await candidate())
    for (const patch of [
      { localVault: 'other-local' },
      { issuer: 'https://other.example' },
      { principal: 'other-device' },
      { facet: 'scoped' as const, grantId: 'sample-grant' },
    ]) {
      expect(
        (await new LinkSnapshotStore(p, { ...binding, ...patch }, () => true).get('sample-note'))
          .kind
      ).toBe('unknown')
    }
  })
  it('never exposes pending novelty after a settled snapshot survives a failed handle clear', async () => {
    const p = meta(),
      original = p.setMeta
    p.setMeta = async (key, value) => {
      if (value !== null) await original(key, value)
    }
    const store = new LinkSnapshotStore(p, binding, () => true)
    await store.seedLocalCreate('sample-note', 'sample-create', 'local-create')
    await expect(store.settle(await candidate())).rejects.toThrow(/settlement was not persisted/)
    expect(await store.localCreate('sample-note')).toBeNull()
  })
  it('cannot relabel an unknown received baseline as a fresh local note', async () => {
    const store = new LinkSnapshotStore(meta(), binding, () => true),
      input = await candidate()
    input.evidence.complete = false
    await store.settle(input)
    expect(await store.seedLocalCreate(input.noteId, 'sample-create', 'local-create')).toBe(false)
  })
  it('received/restored/merged notes never create an empty local baseline', async () => {
    const store = new LinkSnapshotStore(meta(), binding, () => true)
    for (const origin of ['pull', 'restore', 'merge'] as const) {
      const c = await candidate('')
      c.origin = origin
      c.facts = []
      expect(await store.seedLocalCreate(c.noteId, 'sample-create', origin)).toBe(false)
    }
    expect(await store.seedLocalCreate('sample-note', 'sample-create', 'local-create')).toBe(true)
    expect(await store.localCreate('sample-note')).toEqual({
      handle: 'sample-create',
      pending: true,
    })
    await store.settle(await candidate())
    expect(await store.localCreate('sample-note')).toBeNull()
  })
})
