// @vitest-environment node
import { it, expect, vi } from 'vitest'
import { PublicationIntents, type PushUnit } from '@/sync/publication/publicationIntents'
import { publicationFixture } from '../helpers/publicationFixture'
async function setup(extra: number) {
  const input = await publicationFixture(),
    unit: PushUnit = {
      requestId: 'sample-sponsor-budget',
      ops: [
        { op: 'create', path: input.target.path, sha: input.target.sha, size: 1, mtime: 1 },
        {
          op: 'modify',
          file_id: input.current.noteId,
          base_version_id: 'base-note',
          sha: input.current.sha,
          size: 22,
          mtime: 1,
        },
      ],
      createHandles: { 0: input.target.create!.handle },
    },
    data = new Map<string, string>(),
    meta = {
      getMeta: (k: string) => data.get(k) ?? null,
      setMeta: (k: string, v: string | null) => {
        if (v === null) data.delete(k)
        else data.set(k, v)
      },
    },
    port = {
      attest: vi.fn(async () => true),
      inspect: vi.fn(async () => ({
        grantId: 'sample-grant',
        active: true,
        revision: 0,
        admissionGeneration: 1,
        publicationGeneration: 0,
        withdrawalGeneration: 0,
      })),
      verifyReceipt: vi.fn(async () => true),
      lookup: vi.fn(async () => null),
      apply: vi.fn(async () => ({ status: 'applied' as const })),
    }
  let left = extra
  const equal = Math.floor(extra / 3992)
  for (let i = 0; i < 998; i++) {
    const segments = Array.from({ length: 4 }, (_, j) => {
        const add = equal + (left > equal * (3992 - i * 4 - j) ? 1 : 0)
        left -= add
        return String.fromCharCode(97 + j).repeat(105 + add)
      }),
      path = ['LongSample', ...segments, 'sample-' + String(i).padStart(4, '0') + '.bin'].join('/')
    expect(path.length).toBeLessThan(1024)
    unit.ops.push({ op: 'create', path, sha: 'c'.repeat(64), size: 1, mtime: 1 })
    unit.createHandles[i + 2] = 'sample-batch:' + (i + 2)
  }
  expect(left).toBe(0)
  const make = () =>
      new PublicationIntents(
        meta,
        input.binding,
        port,
        () => true,
        () => true
      ),
    manager = make()
  await manager.initialize()
  await manager.prepare(unit, [input])
  return { unit, input, data, make, manager, port }
}
it('an omitted in-unit sponsor is derived as held without growing the whole near-cap envelope', async () => {
  const probe = await setup(0),
    base = [...probe.data.values()][0].length,
    s = await setup(1024 * 1024 - 1 - base),
    before = [...s.data.values()][0],
    indices = s.unit.ops.map((_, i) => i).filter((i) => i !== 1),
    actual = {
      requestId: s.unit.requestId,
      ops: indices.map((i) => s.unit.ops[i]),
      createHandles: Object.fromEntries(
        indices.flatMap((old, index) =>
          s.unit.ops[old].op === 'create' ? [[index, s.unit.createHandles[old]]] : []
        )
      ),
    }
  expect(before.length).toBe(1024 * 1024 - 1)
  await s.manager.bindSubmitted(actual)
  const after = [...s.data.values()][0]
  expect(after.length).toBe(before.length - 1)
  const loaded = await (s.make() as any).read()
  expect(loaded.units[0].intents[0]).toMatchObject({
    state: 'held',
    reason: 'operation not submitted after blob admission',
  })
  expect(JSON.parse(after).ledger.units[0].intents[0]).toMatchObject({ state: 'prepared' })
  expect(JSON.parse(after).ledger.units[0].intents[0].reason).toBeUndefined()
  await s.make().bindSubmitted(actual)
  await s.make().retry(s.unit.requestId)
  expect([...s.data.values()][0]).toBe(after)
  expect(s.port.apply).not.toHaveBeenCalled()
})
