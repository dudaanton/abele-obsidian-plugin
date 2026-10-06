// @vitest-environment node
import { it, expect } from 'vitest'
import { push, resumeJournal, scan, sha256 } from '@abele/sync-core'
import { nativeOwnerAdmissionFixture } from '../helpers/nativeOwnerAdmissionFixture'
async function largeFixture(reduced: boolean, segment = 105) {
  const f = await nativeOwnerAdmissionFixture(reduced ? 'quota_waiting' : 'allow', true)
  await f.fs.remove('Assets/waiting.png')
  await f.fs.remove('Other/ordinary.bin')
  for (let i = 0; i < 999; i++) {
    const path = [
      'LongSample',
      'a'.repeat(segment),
      'b'.repeat(segment),
      'c'.repeat(segment),
      'd'.repeat(segment),
      'sample-' + String(i).padStart(4, '0') + '.bin',
    ].join('/')
    await f.fs.writeAtomic(
      path,
      reduced && i % 10 === 0 ? new Uint8Array([7, 8, 9]) : new Uint8Array([7, 8, i % 253, 10]),
      1
    )
  }
  const found = await scan(f.fs, f.state, { excluded: () => false })
  expect(found.ops).toHaveLength(1000)
  return { f, found }
}
it('recovers already-submitted large legacy prepared rows instead of repeating a permanent budget failure', async () => {
  const { f, found } = await largeFixture(false)
  try {
    const native = f.runtime() as any
    native.intents.bindSubmitted = async () => {
      throw new Error('Synthetic prior permanent binding-budget failure')
    }
    await expect(push(f.transport, f.fs, f.state, found, f.options())).rejects.toThrow(
      /prior permanent/
    )
    expect(f.versionCount()).toBe(0)
    expect(await f.state.getJournal()).toMatchObject({ publicationPhase: 'submitted' })
    const key = 'unit:sample-request',
      value = await native.read(key),
      record = {
        binding: native.options.binding,
        key,
        value: { ops: value.ops, handles: value.handles },
      },
      hash = (v: unknown) => sha256(new TextEncoder().encode(JSON.stringify(v))),
      ledger = await native.intents.read()
    await f.meta.setMeta(
      native.prefix + key,
      JSON.stringify({ ...record, checksum: await hash(record) })
    )
    await f.meta.setMeta(
      native.intents.key,
      JSON.stringify({ ledger, checksum: await hash(ledger) })
    )
    await f.reopen()
    await expect(resumeJournal(f.transport, f.fs, f.state, f.options())).rejects.toThrow(
      'Synthetic successful commit reply lost'
    )
    await f.reopen()
    await resumeJournal(f.transport, f.fs, f.state, f.options())
    expect(await f.state.getJournal()).toBeNull()
    expect(f.versionCount()).toBe(1)
    expect(f.publicationCount()).toBe(0)
    await f.runtime().refreshPublication()
    expect(f.publicationCount()).toBe(1)
    expect(f.wireChecks).toHaveLength(2)
    for (const w of f.wireChecks) expect(w.stored.ops).toEqual(found.ops)
  } finally {
    f.close()
  }
}, 20000)
it('retains the existing storage limit and refuses oversized evidence before upload/submitted phase', async () => {
  const { f, found } = await largeFixture(false, 230)
  try {
    await expect(push(f.transport, f.fs, f.state, found, f.options())).rejects.toThrow(
      'Publication intent storage budget reached'
    )
    expect(await f.state.getJournal()).toMatchObject({ publicationPhase: 'prepared' })
    expect((f.transport.putBlob as any).mock.calls).toHaveLength(0)
    expect(f.wireChecks).toHaveLength(0)
    expect(f.versionCount()).toBe(0)
  } finally {
    f.close()
  }
}, 20000)
for (const reduced of [false, true])
  it(`keeps an allowed 1000-operation ${reduced ? 'reduced' : 'unchanged'} batch replayable across final-binding budget and reopen`, async () => {
    const { f, found } = await largeFixture(reduced)
    try {
      let first: unknown, replay: unknown
      try {
        await push(f.transport, f.fs, f.state, found, f.options())
      } catch (e) {
        first = e
      }
      const journal = await f.state.getJournal(),
        native = f.runtime() as any,
        ledgerRaw = await f.meta.getMeta(native.intents.key)
      expect(ledgerRaw!.length).toBeGreaterThan(550000)
      expect(ledgerRaw!.length).toBeLessThan(1024 * 1024)
      expect(ledgerRaw!.length).toBeLessThanOrEqual(f.preparedBytes[0].intent)
      const nativeRaw = await f.meta.getMeta(native.prefix + 'unit:sample-request')
      expect(nativeRaw!.length).toBeLessThanOrEqual(f.preparedBytes[0].native)
      expect(nativeRaw!.length).toBeLessThan(2 * 1024 * 1024)
      expect(journal).toMatchObject({ publicationPhase: 'submitted' })
      expect(journal!.ops).toHaveLength(reduced ? 900 : 1000)
      await f.reopen()
      try {
        await resumeJournal(f.transport, f.fs, f.state, f.options())
      } catch (e) {
        replay = e
      }
      console.info(
        JSON.stringify({
          reduced,
          preparedBytes: ledgerRaw!.length,
          first: first instanceof Error ? first.message : null,
          replay: replay instanceof Error ? replay.message : null,
          versions: f.versionCount(),
        })
      )
      expect(first).toBeInstanceOf(Error)
      expect((first as Error).message).toBe('Synthetic successful commit reply lost')
      expect(replay).toBeUndefined()
      expect(await f.state.getJournal()).toBeNull()
      expect(f.versionCount()).toBe(1)
      expect(f.publicationCount()).toBe(0)
      await f.runtime().refreshPublication()
      expect(f.publicationCount()).toBe(1)
      expect(f.wireChecks).toHaveLength(2)
      for (const w of f.wireChecks) {
        expect(w.stored.ops).toEqual(journal!.ops)
        expect(w.intentUnit.unit.ops).toEqual(journal!.ops)
      }
      const final = await (f.runtime() as any).read('unit:sample-request')
      expect(final.prepared.ops).toHaveLength(1000)
    } finally {
      f.close()
    }
  }, 20000)
