import { expect, it } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  pull,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { PLACEMENT } from '@/sync/pathCoordinator'

it.each([false, true])(
  'keeps a renamed edit injected at every placement await (bounded=%s)',
  async (bounded) => {
    const bytes = ['sample A', 'sample B', 'sample C'].map((text) => new TextEncoder().encode(text))
    const hashes = await Promise.all(bytes.map((value) => sha256(value)))
    async function run(injectAt?: number) {
      const disk = new MemoryFileSystem(),
        ledger = new MemoryStateStore()
      await disk.writeAtomic('old.md', bytes[0], 1000)
      const base = {
        path: 'old.md',
        wirePath: 'old.md',
        fileId: 'sample-file',
        versionId: 'a',
        sha: hashes[0],
        size: bytes[0].length,
        mtime: 1000,
      }
      await ledger.put(base)
      await ledger.setCursor(1)
      await disk.move('old.md', 'Moved/new.md')
      const points: string[] = []
      let injected = false
      const checkpoint = async (label: string) => {
        points.push(label)
        if (!injected && points.length - 1 === injectAt) {
          injected = true
          // Same stat: only content can distinguish the save from the previous base.
          await disk.writeAtomic('Moved/new.md', bytes[1], 1000)
        }
      }
      const scheduled = <T extends object>(target: T, name: string): T =>
        new Proxy(target, {
          get(object, key) {
            const method = Reflect.get(object, key)
            if (typeof method !== 'function') return method
            const label = `${name}.${String(key)}`
            if (method.constructor.name === 'AsyncGeneratorFunction')
              return async function* (...args: unknown[]) {
                await checkpoint(label + ':before')
                for await (const value of method.apply(object, args)) {
                  await checkpoint(label + ':yield')
                  yield value
                }
                await checkpoint(label + ':after')
              }
            return async (...args: unknown[]) => {
              await checkpoint(label + ':before')
              const result = await method.apply(object, args)
              await checkpoint(label + ':after')
              return result
            }
          },
        })
      const source = (value: Uint8Array) =>
        scheduled(
          {
            size: value.length,
            read: async (offset: number, length: number) => value.slice(offset, offset + length),
            assertUnchanged: async () => {},
            close: async () => {},
          },
          'source'
        )
      Object.assign(disk, {
        [PLACEMENT]: async (_paths: string[], work: () => Promise<unknown>) => work(),
        ...(bounded
          ? {
              openRead: async (path: string) => source(await disk.read(path)),
              beginAtomicWrite: async () => {
                throw new Error('occupied destination must not be replaced')
              },
              reopenStage: async () => {
                throw new Error('no pending stage')
              },
            }
          : {}),
      })
      const change = (seq: number) => ({
        seq,
        file_id: base.fileId,
        version_id: seq === 2 ? 'b' : 'c',
        path: 'Moved/new.md',
        prev_path: seq === 2 ? 'old.md' : null,
        op: seq === 2 ? 'move' : 'modify',
        kind: 'note',
        sha: hashes[seq - 1],
        size: bytes[seq - 1].length,
        mtime: 1000,
        at: '',
        actor: { kind: 'system', id: 'sample', name: 'Sample' },
      })
      const client = scheduled(
        {
          changes: async (since: number) => ({
            items: [change(since + 1)],
            head_seq: 3,
            next_since: since + 1,
          }),
          getBlob: async (sha: string) => bytes[hashes.indexOf(sha)].slice(),
          openVersion: async (_id: string, version: string) =>
            source(bytes[version === 'b' ? 1 : 2]),
        },
        'client'
      ) as unknown as EngineClient
      await pull(client, scheduled(disk, 'fs'), scheduled(ledger, 'state'), {
        filter: { excluded: () => false },
        dirty: new Set(),
        expected: new ExpectedWrites(),
      })
      if (injectAt !== undefined) {
        expect(injected, `unreached await ${injectAt}`).toBe(true)
        expect(
          await disk.read('Moved/new.md'),
          `lost edit at ${injectAt}: ${points[injectAt]}`
        ).toEqual(bytes[1])
        expect(
          await ledger.byFileId(base.fileId),
          `adopted edit at ${injectAt}: ${points[injectAt]}`
        ).toEqual(base)
      }
      return points
    }
    const points = await run()
    expect(points.some((point) => point.includes(String(PLACEMENT)))).toBe(true)
    for (let index = 0; index < points.length; index++) await run(index)
  }
)
