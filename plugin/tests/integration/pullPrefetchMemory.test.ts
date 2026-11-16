// @vitest-environment node
import { expect, it } from 'vitest'
import { ExpectedWrites, MemoryFileSystem, MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import type { ChangeItem } from '@abele/sync-sdk/protocol'
import { Puller } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullRun.js'
import { collectHeap } from '../helpers/collectHeap'

const MiB = 1024 * 1024
const hash = async (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset).getUint32(0).toString(16).padStart(64, '0')

/** Exercise the shipped pull partitioner and prefetcher. The publication sink deliberately
 * retains no file bytes, so this measures transfer ownership independently of the host index. */
async function measure(count: number, conditional: boolean, budget?: number, applied = true) {
  const size = 4096
  const changes: ChangeItem[] = Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    file_id: `sample-${i}`,
    version_id: 'v1',
    path: `Notes/sample-${i}.bin`,
    prev_path: null,
    op: 'create',
    kind: 'attachment',
    sha: i.toString(16).padStart(64, '0'),
    size,
    mtime: 1,
    at: '',
    actor: { kind: 'system', id: 'sample', name: 'Sample' },
  }))
  const fs = new MemoryFileSystem()
  Object.assign(fs, {
    beginAtomicWrite: () => {
      throw new Error('Unexpected staging')
    },
    reopenStage: () => {
      throw new Error('Unexpected staging')
    },
    conditionalFile: conditional
      ? () => {
          throw new Error('Unexpected publication')
        }
      : undefined,
  })
  let downloads = 0,
    consumed = 0,
    peakBytes = 0,
    heapDelta = 0,
    bufferDelta = 0
  const client = {
    openVersion: async (id: string) => ({
      size,
      read: async () => {
        downloads++
        const bytes = new Uint8Array(size)
        new DataView(bytes.buffer).setUint32(0, Number(id.slice('sample-'.length)))
        return bytes
      },
      assertUnchanged: async () => {},
      close: async () => {},
    }),
  }
  const report = { applied: 0, skipped: 0, deferred: 0, held: [], cursor: 0, bootstrapped: false }
  const state = new MemoryStateStore()
  let ledgerReads = 0
  const byFileId = state.byFileId.bind(state)
  state.byFileId = (id) => {
    ledgerReads++
    return byFileId(id)
  }
  const puller = new Puller(
    client as never,
    fs,
    state,
    {
      dirty: new Set(),
      expected: new ExpectedWrites(),
      filter: { excluded: () => false },
      hash,
      ...(budget === undefined ? {} : { prefetchBytes: budget }),
    },
    report
  )
  // Isolate retained content without a second in-memory copy of the vault in the fixture.
  const placer = Reflect.get(puller, 'placer')
  placer.paths = async () => ({ blocked: () => false, resolve: (path: string) => path })
  placer.destinationMatches = async () => false
  placer.localCandidate = async () => null
  const observed = new WeakSet<object>()
  await collectHeap()
  const before = process.memoryUsage()
  Reflect.set(
    puller,
    'take',
    async (
      change: ChangeItem,
      fetched: Map<string, Uint8Array>,
      _local: unknown,
      attempt: { report: { applied: number } }
    ) => {
      if (!observed.has(fetched)) {
        observed.add(fetched)
        peakBytes = Math.max(
          peakBytes,
          [...fetched.values()].reduce((n, bytes) => n + bytes.byteLength, 0)
        )
        if (consumed === 0) {
          await collectHeap()
          const memory = process.memoryUsage()
          heapDelta = memory.heapUsed - before.heapUsed
          bufferDelta = memory.arrayBuffers - before.arrayBuffers
        }
      }
      expect(await hash(fetched.get(change.sha!)!)).toBe(change.sha)
      consumed++
      if (applied) attempt.report.applied++
    }
  )
  await Reflect.get(puller, 'placeTaking').call(puller, changes, new Map(), async () => {})
  await collectHeap()
  const settled = process.memoryUsage()
  expect(consumed).toBe(count)
  expect(downloads).toBe(count)
  return {
    count,
    ledgerReads,
    peakBytes,
    heapDelta,
    bufferDelta,
    settledHeapDelta: settled.heapUsed - before.heapUsed,
    settledBufferDelta: settled.arrayBuffers - before.arrayBuffers,
  }
}

it('bounds retained pull content independently of a 33000-path inventory', async () => {
  const memory = await measure(33000, true)
  console.info('pull memory model', memory)
  expect(memory.peakBytes).toBeLessThanOrEqual(8 * MiB)
  expect(memory.bufferDelta).toBeLessThanOrEqual(9 * MiB)
  expect(memory.heapDelta).toBeLessThan(32 * MiB)
  expect(memory.settledBufferDelta).toBeLessThan(MiB)
}, 60000)

it.each([true, false])(
  'counts buffered streaming bytes with conditional publication=%s',
  async (conditional) => {
    const memory = await measure(32, conditional, 2048)
    expect(memory.peakBytes).toBe(4096)
  }
)

it('does not build new source hints for hashes that no later file needs', async () => {
  const baseline = await measure(32, true, undefined, false)
  const memory = await measure(32, true)
  expect(memory.ledgerReads).toBe(baseline.ledgerReads)
})

it.each([
  { edit: false, capacity: 1 },
  { edit: true, capacity: 1 },
  { edit: false, capacity: 2 },
])(
  'reuses content only while its source is unchanged: edit=$edit, capacity=$capacity',
  async ({ edit, capacity }) => {
    const bytes = new TextEncoder().encode('sample remote content')
    const sha = await sha256(bytes)
    const fs = new MemoryFileSystem()
    Object.assign(fs, {
      beginAtomicWrite: () => {
        throw new Error('Unexpected staging')
      },
      reopenStage: () => {
        throw new Error('Unexpected staging')
      },
      openRead: async (path: string) => {
        const data = await fs.read(path)
        return {
          size: data.length,
          read: async () => data,
          assertUnchanged: async () => {},
          close: async () => {},
        }
      },
    })
    const state = new MemoryStateStore()
    let downloads = 0
    const report = { applied: 0, skipped: 0, deferred: 0, held: [], cursor: 0, bootstrapped: false }
    const puller = new Puller(
      {
        openVersion: async () => {
          downloads++
          return {
            size: bytes.length,
            read: async () => bytes.slice(),
            assertUnchanged: async () => {},
            close: async () => {},
          }
        },
      } as never,
      fs,
      state,
      {
        dirty: new Set(),
        expected: new ExpectedWrites(),
        filter: { excluded: () => false },
        prefetchBytes: bytes.length * capacity,
        onApplied: async (change) => {
          if (edit && change.path === 'first.bin')
            await fs.writeAtomic('first.bin', new TextEncoder().encode('local edit'), 2)
        },
      },
      report
    )
    await puller.apply(
      ['first.bin', 'second.bin'].map((path, i) => ({
        seq: i + 1,
        file_id: `sample-${i}`,
        version_id: 'v1',
        path,
        prev_path: null,
        op: 'create',
        kind: 'attachment',
        sha,
        size: bytes.length,
        mtime: 1,
        at: '',
        actor: { kind: 'system', id: 'sample', name: 'Sample' },
      }))
    )
    expect(report.applied).toBe(2)
    expect(await fs.read('second.bin')).toEqual(bytes)
    expect(new TextDecoder().decode(await fs.read('first.bin'))).toBe(
      edit ? 'local edit' : 'sample remote content'
    )
    expect(downloads).toBe(edit ? 2 : 1)
  }
)
