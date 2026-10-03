// @vitest-environment node
import { it, expect } from 'vitest'
import { push, resumeJournal, scan, sha256 } from '@abele/sync-core'
import { AbeleError } from '@abele/sync-protocol'
import { nativeOwnerAdmissionFixture } from '../helpers/nativeOwnerAdmissionFixture'
const limit = 1024 * 1024
async function populated(extra: number, lose: boolean) {
  const f = await nativeOwnerAdmissionFixture('allow', lose)
  await f.fs.remove('Assets/waiting.png')
  await f.fs.remove('Other/ordinary.bin')
  let left = extra
  const equal = Math.floor(extra / 3996)
  for (let i = 0; i < 999; i++) {
    const segments = Array.from({ length: 4 }, (_, j) => {
        const add = equal + (left > equal * (3996 - i * 4 - j) ? 1 : 0)
        left -= add
        return String.fromCharCode(97 + j).repeat(105 + add)
      }),
      path = ['LongSample', ...segments, 'sample-' + String(i).padStart(4, '0') + '.bin'].join('/')
    expect(segments.every((s) => s.length <= 255)).toBe(true)
    expect(path.length).toBeLessThan(1024)
    await f.fs.writeAtomic(path, new Uint8Array([7, 8, i % 253, 10]), 1)
  }
  expect(left).toBe(0)
  return { f, found: await scan(f.fs, f.state, { excluded: () => false }) }
}
async function calibrated() {
  const probe = await populated(0, false)
  try {
    const options = probe.f.options(),
      before = options.beforeUpload
    await expect(
      push(probe.f.transport, probe.f.fs, probe.f.state, probe.found, {
        ...options,
        beforeUpload: async (u) => {
          await before(u)
          throw new Error('Synthetic after prepare size probe')
        },
      })
    ).rejects.toThrow('Synthetic after prepare size probe')
    return limit - 1 - probe.f.preparedBytes[0].intent
  } finally {
    probe.f.close()
  }
}
it('does not grow the whole near-limit ledger when admission omits the actual publication target', async () => {
  const extra = await calibrated(),
    { f, found } = await populated(extra, true)
  try {
    expect(found.ops).toHaveLength(1000)
    const target = (found.ops[0] as any).sha,
      upload = f.transport.putBlob.bind(f.transport)
    f.transport.putBlob = async (sha, bytes) => {
      if (sha === target)
        throw new AbeleError('quota_waiting', 'Synthetic target admission refusal')
      return upload(sha, bytes)
    }
    let first: unknown, replay: unknown
    try {
      await push(f.transport, f.fs, f.state, found, f.options())
    } catch (e) {
      first = e
    }
    expect(f.preparedBytes[0].intent).toBe(limit - 1)
    const journal = await f.state.getJournal()
    expect(journal).toMatchObject({ publicationPhase: 'submitted' })
    expect(journal!.ops).toHaveLength(999)
    await f.reopen()
    try {
      await resumeJournal(f.transport, f.fs, f.state, f.options())
    } catch (e) {
      replay = e
    }
    console.info(
      JSON.stringify({
        prepared: f.preparedBytes[0].intent,
        first: first instanceof Error ? first.message : null,
        replay: replay instanceof Error ? replay.message : null,
        journalOps: journal!.ops.length,
        bound: f.wireChecks[0]?.intentBytes,
        nativePrepared: f.preparedBytes[0].native,
        nativeBound: f.wireChecks[0]?.nativeBytes,
        versions: f.versionCount(),
      })
    )
    expect((first as Error).message).toBe('Synthetic successful commit reply lost')
    expect(replay).toBeUndefined()
    expect(await f.state.getJournal()).toBeNull()
    expect(f.versionCount()).toBe(1)
    expect(f.publicationCount()).toBe(0)
    for (const wire of f.wireChecks) {
      expect(wire.intentBytes).toBeLessThanOrEqual(f.preparedBytes[0].intent)
      expect(wire.nativeBytes).toBeLessThanOrEqual(f.preparedBytes[0].native)
      expect(wire.stored.ops).toEqual(journal!.ops)
      expect(wire.intentUnit.intents[0]).toMatchObject({
        state: 'held',
        reason: 'operation not submitted after blob admission',
      })
    }
    const native = f.runtime() as any,
      raw = await f.meta.getMeta(native.intents.key)
    expect(raw!.length).toBeLessThanOrEqual(f.preparedBytes[0].intent)
  } finally {
    f.close()
  }
}, 20000)
const hash = (v: unknown) => sha256(new TextEncoder().encode(JSON.stringify(v)))
async function rejectTarget(
  f: Awaited<ReturnType<typeof nativeOwnerAdmissionFixture>>,
  target: string
) {
  const upload = f.transport.putBlob.bind(f.transport)
  f.transport.putBlob = async (sha, bytes) => {
    if (sha === target) throw new AbeleError('quota_waiting', 'Synthetic target admission refusal')
    return upload(sha, bytes)
  }
}
it('replays valid legacy v1 metadata with saved submission/submitted evidence, not just prepared rows', async () => {
  const f = await nativeOwnerAdmissionFixture('allow', true)
  try {
    await rejectTarget(f, (f.scan.ops[0] as any).sha)
    await expect(push(f.transport, f.fs, f.state, f.scan, f.options())).rejects.toThrow(
      'Synthetic successful commit reply lost'
    )
    const native = f.runtime() as any,
      key = 'unit:sample-request',
      value = await native.read(key),
      ledger = await native.intents.read()
    expect(value.submitted).toBe(true)
    expect(ledger.units[0].submission).toBeDefined()
    const record = { binding: native.options.binding, key, value }
    await f.meta.setMeta(
      native.prefix + key,
      JSON.stringify({ ...record, checksum: await hash(record) })
    )
    await f.meta.setMeta(
      native.intents.key,
      JSON.stringify({ ledger, checksum: await hash(ledger) })
    )
    await f.reopen()
    await resumeJournal(f.transport, f.fs, f.state, f.options())
    expect(await f.state.getJournal()).toBeNull()
    expect(f.versionCount()).toBe(1)
    expect(f.publicationCount()).toBe(0)
    const recovered = await (f.runtime() as any).intents.read()
    expect(recovered.units[0].intents[0]).toMatchObject({
      state: 'held',
      reason: 'operation not submitted after blob admission',
    })
    expect(f.wireChecks[1].stored.ops).toEqual([f.scan.ops[2]])
  } finally {
    f.close()
  }
})
it('accepted near-cap v2 legacy bound metadata with a serialized held reason remains replayable', async () => {
  const { f, found } = await populated((await calibrated()) - 51, true)
  try {
    await rejectTarget(f, (found.ops[0] as any).sha)
    await expect(push(f.transport, f.fs, f.state, found, f.options())).rejects.toThrow(
      'Synthetic successful commit reply lost'
    )
    const native = f.runtime() as any,
      old = JSON.parse((await f.meta.getMeta(native.intents.key))!)
    old.ledger.units[0].intents[0].state = 'held'
    old.ledger.units[0].intents[0].reason = 'operation not submitted after blob admission'
    old.checksum = await hash(old.ledger)
    const raw = JSON.stringify(old)
    expect(raw.length).toBe(limit - 1)
    await f.meta.setMeta(native.intents.key, raw)
    await f.reopen()
    await resumeJournal(f.transport, f.fs, f.state, f.options())
    expect(await f.state.getJournal()).toBeNull()
    expect(f.versionCount()).toBe(1)
    expect(f.publicationCount()).toBe(0)
    const recovered = (f.runtime() as any).intents,
      view = await recovered.read()
    expect(view.units[0].intents[0]).toMatchObject({
      state: 'held',
      reason: 'operation not submitted after blob admission',
    })
    await recovered.write(view)
    const normalized = await f.meta.getMeta(recovered.key)
    expect(normalized!.length).toBe(raw.length - 52)
    expect(JSON.parse(normalized!).ledger.units[0].intents[0].reason).toBeUndefined()
    await f.reopen()
    const reopened = (f.runtime() as any).intents,
      again = await reopened.read()
    await reopened.bindSubmitted(again.units[0].unit)
    expect(again.units[0].intents[0]).toMatchObject({
      state: 'held',
      reason: 'operation not submitted after blob admission',
    })
  } finally {
    f.close()
  }
}, 20000)
