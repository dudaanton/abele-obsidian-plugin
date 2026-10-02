import { describe, expect, it, vi } from 'vitest'
import {
  PublicationIntents,
  type PushReceipt,
  type PushUnit,
} from '@/sync/publication/publicationIntents'
import { publicationFixture } from '../helpers/publicationFixture'
async function setup() {
  const input = await publicationFixture(),
    data = new Map<string, string>(),
    meta = {
      getMeta: async (k: string) => data.get(k) ?? null,
      setMeta: async (k: string, v: string | null) => {
        if (v === null) data.delete(k)
        else data.set(k, v)
      },
    }
  const authority = {
    grantId: 'sample-grant',
    active: true,
    revision: 1,
    admissionGeneration: 1,
    publicationGeneration: 0,
    withdrawalGeneration: 0,
    targetFileId: 'sample-asset',
    targetVersionId: 'asset-v1',
    sponsorFileId: 'sample-note',
    sponsorVersionId: 'note-v1',
  }
  const port = {
    attest: vi.fn(async () => true),
    verifyReceipt: vi.fn(async () => true),
    inspect: vi.fn(async () => authority),
    apply: vi.fn(async () => ({ status: 'applied' as const })),
    lookup: vi.fn(async (_delta: unknown) => null as { status: 'applied' } | null),
  }
  const unit: PushUnit = {
    requestId: 'sample-request',
    ops: [
      { op: 'create', path: input.target.path, sha: input.target.sha, size: 1, mtime: 1 },
      {
        op: 'modify',
        file_id: 'sample-note',
        base_version_id: 'base-note',
        sha: input.current.sha,
        size: 22,
        mtime: 1,
      },
    ],
    createHandles: { 0: 'sample-create' },
  }
  const receipt: PushReceipt = {
    requestId: unit.requestId,
    ops: unit.ops,
    outcomes: [
      {
        index: 0,
        status: 'created',
        fileId: 'sample-asset',
        versionId: 'asset-v1',
        sha: input.target.sha,
        path: input.target.path,
      },
      {
        index: 1,
        status: 'applied',
        fileId: 'sample-note',
        versionId: 'note-v1',
        sha: input.current.sha,
        path: 'Shared/sample.md',
      },
    ],
  }
  const make = () =>
    new PublicationIntents(
      meta,
      input.binding,
      port,
      () => true,
      () => true
    )
  await make().initialize()
  return { input, data, meta, port, unit, receipt, make, authority }
}
describe('disabled durable publication intent integration', () => {
  it('default fence performs no persistence or publication', async () => {
    const s = await setup(),
      m = new PublicationIntents(s.meta, s.input.binding, s.port)
    await expect(m.prepare(s.unit, [s.input])).rejects.toThrow(/disabled/)
    expect(s.data.size).toBe(1)
    expect([...s.data.values()][0]).not.toContain('sample-request')
    expect(s.port.apply).not.toHaveBeenCalled()
  })
  it('persists before upload, recovers after file commit, retries the same lost list receipt and never prompts again', async () => {
    const s = await setup(),
      m = s.make()
    await m.prepare(s.unit, [s.input])
    expect(s.data.size).toBeGreaterThan(0)
    await s.make().settle(s.receipt)
    s.port.apply.mockRejectedValueOnce(new Error('Synthetic successful list response lost'))
    await expect(s.make().retry(s.unit.requestId)).rejects.toThrow(/lost/)
    const sent = structuredClone(s.port.apply.mock.calls[0][0])
    await s.make().retry(s.unit.requestId)
    expect(s.port.apply.mock.calls[1][0]).toEqual(sent)
    await s.make().retry(s.unit.requestId)
    expect(s.port.apply).toHaveBeenCalledTimes(2)
  })
  it.each(['adopted', 'merged', 'conflict', 'rejected'])(
    'does not publish a create %s receipt',
    async (status) => {
      const s = await setup()
      await s.make().prepare(s.unit, [s.input])
      s.receipt.outcomes[0].status = status as any
      await s.make().settle(s.receipt)
      await s.make().retry(s.unit.requestId)
      expect(s.port.apply).not.toHaveBeenCalled()
    }
  )
  it('an applied create without novel-identity proof is not a created receipt', async () => {
    const s = await setup()
    await s.make().prepare(s.unit, [s.input])
    s.receipt.outcomes[0].status = 'applied'
    await s.make().settle(s.receipt)
    await s.make().retry(s.unit.requestId)
    expect(s.port.apply).not.toHaveBeenCalled()
  })
  it('a lost successful delta receipt is reconciled before changed publication revision, without re-add after unshare', async () => {
    const s = await setup()
    await s.make().prepare(s.unit, [s.input])
    await s.make().settle(s.receipt)
    s.port.apply.mockRejectedValueOnce(new Error('Synthetic applied response lost'))
    await expect(s.make().retry(s.unit.requestId)).rejects.toThrow(/lost/)
    s.port.inspect.mockResolvedValue({
      ...s.authority,
      publicationGeneration: 2,
      withdrawalGeneration: 1,
    })
    s.port.lookup.mockResolvedValue({ status: 'applied' })
    await s.make().retry(s.unit.requestId)
    expect(s.port.lookup).toHaveBeenCalled()
    expect(s.port.apply).toHaveBeenCalledTimes(1)
    const ledger = JSON.parse([...s.data.values()][0]).ledger
    expect(ledger.units[0].intents[0].state).toBe('published')
  })
  it('unknown paste cache is sealed before upload and cannot be upgraded after settlement', async () => {
    const s = await setup()
    s.input.current.evidence.complete = false
    await s.make().prepare(s.unit, [s.input])
    s.input.current.evidence.complete = true
    await s.make().prepare(s.unit, [s.input])
    await s.make().settle(s.receipt)
    await s.make().retry(s.unit.requestId)
    expect(s.port.apply).not.toHaveBeenCalled()
  })
  it('unshare, sponsor departure and target replacement invalidate pending retry', async () => {
    for (const field of [
      'withdrawalGeneration',
      'admissionGeneration',
      'targetVersionId',
      'sponsorVersionId',
    ] as const) {
      const s = await setup()
      await s.make().prepare(s.unit, [s.input])
      await s.make().settle(s.receipt)
      s.port.inspect.mockResolvedValue({
        ...s.authority,
        [field]: typeof s.authority[field] === 'number' ? 99 : 'other-version',
      })
      await s.make().retry(s.unit.requestId)
      expect(s.port.apply).not.toHaveBeenCalled()
    }
  })
  it('resolves pending sponsor and target handles only from exact novel create receipts', async () => {
    const s = await setup()
    s.input.baseline = {
      kind: 'local-create',
      binding: s.input.binding,
      noteId: s.input.current.noteId,
      handle: 'sample-note-create',
      pending: true,
      hasLedgerIdentity: false,
    }
    s.input.owner = {
      ...s.input.owner,
      kind: 'owner-create',
      baseVersionId: null,
      baseCreateHandle: 'sample-note-create',
    }
    s.unit.ops[1] = {
      op: 'create',
      path: 'Shared/sample.md',
      sha: s.input.current.sha,
      size: 22,
      mtime: 1,
    }
    s.unit.createHandles[1] = 'sample-note-create'
    s.receipt.ops = s.unit.ops
    s.receipt.outcomes[1] = {
      ...s.receipt.outcomes[1],
      status: 'created',
      fileId: 'created-server-note',
    }
    s.port.inspect.mockResolvedValue({ ...s.authority, sponsorFileId: 'created-server-note' })
    await s.make().prepare(s.unit, [s.input])
    await s.make().settle(s.receipt)
    await s.make().retry(s.unit.requestId)
    expect(s.port.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        sponsor: expect.objectContaining({ fileId: 'created-server-note' }),
      })
    )
  })
  it('refuses a changed operation under the recovered request ID', async () => {
    const s = await setup()
    await s.make().prepare(s.unit, [s.input])
    s.unit.ops[0] = { ...s.unit.ops[0], sha: 'b'.repeat(64) } as any
    await expect(s.make().prepare(s.unit, [s.input])).rejects.toThrow(/identity|request/)
    expect(s.port.apply).not.toHaveBeenCalled()
  })
  it('lost intent storage and changed persisted delta are recovery, never a new intent', async () => {
    const s = await setup()
    await s.make().prepare(s.unit, [s.input])
    s.data.clear()
    await expect(s.make().prepare(s.unit, [s.input])).rejects.toThrow(/missing|recovery/)
    expect(s.port.apply).not.toHaveBeenCalled()
    const t = await setup()
    await t.make().prepare(t.unit, [t.input])
    await t.make().settle(t.receipt)
    const [key, raw] = [...t.data][0],
      envelope = JSON.parse(raw)
    envelope.ledger.units[0].intents[0].deltas[0].value.target.fileId = 'other-file'
    t.data.set(key, JSON.stringify(envelope))
    await expect(t.make().retry(t.unit.requestId)).rejects.toThrow(/unreadable|recovery/)
  })
  it('failed durable write, wrong receipt and lost writer permit no publication', async () => {
    const s = await setup(),
      bad = { ...s.meta, setMeta: vi.fn(async () => {}) }
    await expect(
      new PublicationIntents(
        bad,
        s.input.binding,
        s.port,
        () => true,
        () => true
      ).prepare(s.unit, [s.input])
    ).rejects.toThrow(/persist/)
    await s.make().prepare(s.unit, [s.input])
    s.port.verifyReceipt.mockResolvedValue(false)
    await expect(s.make().settle(s.receipt)).rejects.toThrow(/receipt/)
    await expect(
      new PublicationIntents(
        s.meta,
        s.input.binding,
        s.port,
        () => true,
        () => false
      ).retry(s.unit.requestId)
    ).rejects.toThrow(/writer/)
    expect(s.port.apply).not.toHaveBeenCalled()
  })
})
