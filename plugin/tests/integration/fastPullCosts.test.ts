import { expect, it, vi } from 'vitest'
import { IDBFactory, IDBDatabase } from 'fake-indexeddb'
import { ExpectedWrites, sha256 } from '@abele/sync-sdk/core'
import { Puller } from '../../node_modules/@abele/sync-sdk/dist/internal/core/pullRun.js'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { connectionAdapter } from '@/sync/connectionScope'

async function measure(folder: boolean) {
  const app = buildFakeVault([])
  const state = await IndexedDbStateStore.open(new IDBFactory(), 'sample-fast-pull')
  let writes = 0,
    bridge = 0,
    active = 0,
    maximum = 0
  const transaction = IDBDatabase.prototype.transaction
  const observed = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
    ...args
  ) {
    if (args[1] === 'readwrite') writes++
    return transaction.apply(this, args)
  })
  const fs = new ObsidianFileSystem(app as never, {
    ...(folder
      ? {
          fileScope: 'shared',
          connectionId: 'sample',
          adapter: connectionAdapter(app.vault.adapter, 'shared', '.abele-sync/connections/sample'),
        }
      : {}),
    diagnostic: (operation) => {
      if (operation.startsWith('adapter ')) bridge++
    },
  })
  const changes = await Promise.all(
    Array.from({ length: 32 }, async (_, i) => {
      const bytes = new Uint8Array([i])
      return {
        seq: i + 1,
        file_id: `sample-${i}`,
        version_id: 'v1',
        path: `${folder ? 'shared/' : ''}notes/sample-${i}.md`,
        prev_path: null,
        op: 'create' as const,
        kind: 'note' as const,
        sha: await sha256(bytes),
        size: 1,
        mtime: 1000,
        at: '',
        actor: { kind: 'system' as const, id: 'sample', name: 'Sample' },
        bytes,
      }
    })
  )
  const openVersion = async (id: string) => {
    active++
    maximum = Math.max(maximum, active)
    return {
      size: 1,
      read: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        return changes.find((one) => one.file_id === id)!.bytes
      },
      assertUnchanged: async () => {},
      close: async () => {
        active--
      },
    }
  }
  const report = { applied: 0, skipped: 0, deferred: 0, held: [], cursor: 0, bootstrapped: false }
  const puller = new Puller(
    { openVersion } as never,
    fs,
    state,
    { dirty: new Set(), expected: new ExpectedWrites(), filter: { excluded: () => false } },
    report
  )
  const placements = vi.spyOn(fs, 'writeAtomic')
  try {
    await Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).call(fs, () =>
      puller.apply(changes)
    )
    console.log('[first pull costs]', { files: changes.length, bridge, writes, maximum })
    expect(report.applied).toBe(32)
    expect(report.held).toEqual([])
    expect(maximum).toBe(8)
    expect(bridge).toBeLessThanOrEqual(32 * 5 + 8)
    expect(writes).toBeLessThanOrEqual(32 * 2 + 1)
    expect(placements.mock.calls.map(([path]) => path)).toEqual(changes.map((one) => one.path))
    for (const change of changes) expect(await fs.read(change.path)).toEqual(change.bytes)
    return { bridge, writes, files: changes.length }
  } finally {
    observed.mockRestore()
    state.close()
  }
}

it.each([false, true])('bounds first-pull costs and order (folder=%s)', measure)

it.fails('BUG: first pull still needs more than four bridge operations per file', async () => {
  const counts = await measure(false)
  expect(counts.bridge).toBeLessThanOrEqual(counts.files * 4 + 8)
})

it.fails(
  'BUG: durable pull intent and ledger settlement still use separate transactions',
  async () => {
    const counts = await measure(false)
    expect(counts.writes).toBeLessThanOrEqual(counts.files + 1)
  }
)
