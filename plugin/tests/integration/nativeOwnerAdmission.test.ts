// @vitest-environment node
import { it, expect } from 'vitest'
import { push, resumeJournal, sha256 } from '@abele/sync-core'
import { nativeOwnerAdmissionFixture } from '../helpers/nativeOwnerAdmissionFixture'
it('a replay cannot change the already-bound admitted request or remint a new effect', async () => {
  const f = await nativeOwnerAdmissionFixture('quota_waiting', true)
  try {
    await expect(push(f.transport, f.fs, f.state, f.scan, f.options())).rejects.toThrow(
      'Synthetic successful commit reply lost'
    )
    const journal = (await f.state.getJournal())!
    await f.state.setJournal({ ...journal, ops: [{ ...journal.ops[0], mtime: 99 } as any] })
    await f.reopen()
    await expect(resumeJournal(f.transport, f.fs, f.state, f.options())).rejects.toThrow(
      /submitted request identity changed/
    )
    expect(f.wireChecks).toHaveLength(1)
    expect(f.versionCount()).toBe(1)
    expect(f.publicationCount()).toBe(0)
    expect(await f.state.getJournal()).not.toBeNull()
  } finally {
    f.close()
  }
})
it('recovers a legacy prepared candidate row against the already-submitted exact core journal without certifying the old mismatching body', async () => {
  const f = await nativeOwnerAdmissionFixture('quota_waiting', true)
  try {
    await expect(push(f.transport, f.fs, f.state, f.scan, f.options())).rejects.toThrow(
      'Synthetic successful commit reply lost'
    )
    const native = f.runtime() as any,
      row = await native.read('unit:sample-request'),
      ledger = await native.intents.read(),
      unit = ledger.units[0]
    unit.unit = unit.submission.prepared
    unit.sha = unit.submission.sha
    delete unit.submission
    await native.persisted('unit:sample-request', row.prepared)
    await f.meta.setMeta(
      native.intents.key,
      JSON.stringify({
        ledger,
        checksum: await sha256(new TextEncoder().encode(JSON.stringify(ledger))),
      })
    )
    await f.reopen()
    await resumeJournal(f.transport, f.fs, f.state, f.options())
    expect(f.versionCount()).toBe(1)
    expect(f.publicationCount()).toBe(0)
    await f.runtime().refreshPublication()
    expect(f.publicationCount()).toBe(1)
    expect(await f.state.getJournal()).toBeNull()
    expect(f.wireChecks[1].stored.ops).toEqual([f.ops[0]])
    expect(f.wireChecks[1].intentUnit.submission.prepared.ops).toEqual([f.ops[0], f.ops[2]])
    await expect(
      (f.runtime() as any).intents.settle({
        requestId: 'sample-request',
        ops: [f.ops[0], f.ops[2]],
        outcomes: [],
      })
    ).rejects.toThrow('Exact publication receipt proof required')
  } finally {
    f.close()
  }
})
it('a failed native submitted-binding write prevents transport and resumes the exact already-filtered journal', async () => {
  const f = await nativeOwnerAdmissionFixture('quota_waiting')
  try {
    const native = f.runtime() as any,
      original = native.persisted.bind(native)
    native.persisted = async (key: string, value: any) => {
      if (value.submitted) throw new Error('Synthetic submitted binding persistence failure')
      return original(key, value)
    }
    await expect(push(f.transport, f.fs, f.state, f.scan, f.options())).rejects.toThrow(
      /submitted binding persistence/
    )
    expect(f.wireChecks).toHaveLength(0)
    expect(f.versionCount()).toBe(0)
    expect(await f.state.getJournal()).toMatchObject({
      publicationPhase: 'submitted',
      ops: [f.ops[0]],
    })
    await f.reopen()
    await resumeJournal(f.transport, f.fs, f.state, f.options())
    expect(f.versionCount()).toBe(1)
    expect(f.publicationCount()).toBe(0)
    await f.runtime().refreshPublication()
    expect(f.publicationCount()).toBe(1)
    expect(f.wireChecks[0].stored.ops).toEqual([f.ops[0]])
    expect(await f.state.getJournal()).toBeNull()
  } finally {
    f.close()
  }
})
it('receipt storage references the exact frozen unit digest, never a different submitted body', async () => {
  const f = await nativeOwnerAdmissionFixture('quota_waiting')
  try {
    await push(f.transport, f.fs, f.state, f.scan, f.options())
    const native = f.runtime() as any,
      key = 'receipt:sample-request',
      metaKey = native.prefix + key,
      stored = JSON.parse((await f.meta.getMeta(metaKey))!)
    expect(stored.value.ops).toBeUndefined()
    expect(stored.value.opsSha).toMatch(/^[a-f0-9]{64}$/)
    expect((await native.read(key)).ops).toEqual([f.ops[0]])
    stored.value.opsSha = 'f'.repeat(64)
    stored.checksum = await sha256(
      new TextEncoder().encode(
        JSON.stringify({ binding: stored.binding, key: stored.key, value: stored.value })
      )
    )
    await f.meta.setMeta(metaKey, JSON.stringify(stored))
    await expect(native.read(key)).rejects.toThrow(/evidence corrupt/)
  } finally {
    f.close()
  }
})
it('retains exact receipt metadata inside settlement but defers every publication effect until afterward', async () => {
  const f = await nativeOwnerAdmissionFixture('quota_waiting')
  let depth = 0
  const transaction = f.state.transaction.bind(f.state)
  f.state.transaction = async (work) => {
    depth++
    try {
      return await transaction(work)
    } finally {
      depth--
    }
  }
  ;(f.runtime() as any).options.settling = () => depth > 0
  try {
    await push(f.transport, f.fs, f.state, f.scan, f.options())
    expect(await f.state.getJournal()).toBeNull()
    expect(f.versionCount()).toBe(1)
    expect(f.publicationCount()).toBe(0)
    depth = 1
    await f.runtime().refreshPublication()
    expect(f.publicationCount()).toBe(0)
    depth = 0
    await f.runtime().refreshPublication()
    expect(f.publicationCount()).toBe(1)
  } finally {
    depth = 0
    f.close()
  }
})
it('a discovery pause blocks settled publication replay without retiring its exact receipt', async () => {
  const f = await nativeOwnerAdmissionFixture('quota_waiting')
  try {
    await push(f.transport, f.fs, f.state, f.scan, f.options())
    expect(f.versionCount()).toBe(1)
    expect(f.publicationCount()).toBe(0)
    const native = f.runtime() as any
    const receipt = await native.read('receipt:sample-request')
    native.setAudiences([]) // The old discovery pause did only this.
    native.setAutomaticPaused?.(true)
    await native.refreshPublication()
    await native.refreshPublication()
    expect(f.publicationCount()).toBe(0)
    expect(await native.read('receipt:sample-request')).toEqual(receipt)
    native.setAutomaticPaused?.(false)
    await native.refreshPublication()
    expect(f.publicationCount()).toBe(1)
  } finally {
    f.close()
  }
})
for (const code of ['too_large', 'quota_exceeded', 'quota_waiting'] as const) {
  it(`binds the final admitted commit before transport after ${code}, then settles without weakening exact receipts`, async () => {
    const f = await nativeOwnerAdmissionFixture(code)
    try {
      await push(f.transport, f.fs, f.state, f.scan, f.options())
      expect(await f.state.getJournal()).toBeNull()
      expect(f.versionCount()).toBe(1)
      expect(f.publicationCount()).toBe(0)
      await f.runtime().refreshPublication()
      expect(f.publicationCount()).toBe(1)
      expect(f.wireChecks).toHaveLength(1)
      const wire = f.wireChecks[0]
      expect(wire.ops).toEqual([f.ops[0]])
      expect(wire.stored.ops).toEqual(wire.ops)
      expect(wire.intentUnit.unit.ops).toEqual(wire.ops)
      expect(wire.intentUnit.unit.createHandles).toEqual({
        0: Object.values(wire.stored.handles)[0],
      })
      expect(await f.state.get('Other/ordinary.bin')).toBeNull()
    } finally {
      f.close()
    }
  })
  it(`reopens and replays the identical admitted body after ${code} and a lost successful reply`, async () => {
    const f = await nativeOwnerAdmissionFixture(code, true)
    try {
      await expect(push(f.transport, f.fs, f.state, f.scan, f.options())).rejects.toThrow(
        'Synthetic successful commit reply lost'
      )
      const journal = await f.state.getJournal()
      expect(journal).toMatchObject({
        idempotencyKey: 'sample-request',
        publicationPhase: 'submitted',
        ops: [f.ops[0]],
      })
      await f.reopen()
      await resumeJournal(f.transport, f.fs, f.state, f.options())
      expect(await f.state.getJournal()).toBeNull()
      expect(f.versionCount()).toBe(1)
      expect(f.publicationCount()).toBe(0)
      await f.runtime().refreshPublication()
      expect(f.publicationCount()).toBe(1)
      expect(f.wireChecks.map((w) => w.ops)).toEqual([[f.ops[0]], [f.ops[0]]])
      for (const w of f.wireChecks) {
        expect(w.stored.ops).toEqual(w.ops)
        expect(w.intentUnit.unit.ops).toEqual(w.ops)
      }
      expect((f.transport.putBlob as any).mock.calls).toHaveLength(2)
    } finally {
      f.close()
    }
  })
}
