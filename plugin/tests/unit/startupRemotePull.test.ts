import { expect, it, vi } from 'vitest'
import {
  EngineError,
  MemoryFileSystem,
  MemoryStateStore,
  SyncEngine,
  sha256,
  selectiveDefaults,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { VaultSettingsSchema } from '@abele/sync-sdk/protocol'

it('applies a remote note before fingerprinting an unrelated startup file completes', () =>
  remoteBeforeLocalWork('fingerprint'))

// BUG: SDK reconciliationScan enumerates the whole inventory before the first pull.
it.fails('applies a remote note while the startup inventory is still being enumerated', () =>
  remoteBeforeLocalWork('inventory')
)

async function remoteBeforeLocalWork(block: 'fingerprint' | 'inventory') {
  const fs = new MemoryFileSystem(),
    state = new MemoryStateStore()
  const local = new TextEncoder().encode('sample local attachment')
  const remote = new TextEncoder().encode('sample remote note')
  await fs.writeAtomic('local.bin', local, 1000)
  let entered!: () => void, release!: () => void
  const fingerprinting = new Promise<void>((resolve) => {
    entered = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const fingerprint = async (path: string) => {
    if (block === 'fingerprint' && path === 'local.bin') {
      entered()
      await blocked
    }
    const bytes = await fs.read(path)
    return { size: bytes.length, sha: await sha256(bytes) }
  }
  const item = {
    file_id: 'remote-file',
    version_id: 'remote-version',
    path: 'remote.md',
    sha: await sha256(remote),
    size: remote.length,
    mtime: 2000,
    seq: 1,
    kind: 'note',
  }
  const getBlob = vi.fn(async () => remote.slice())
  const client = {
    state: async () => ({ head_seq: 1, settings: VaultSettingsSchema.parse({}), usage: {} }),
    manifest: async () => ({ items: [item], head_seq: 1, next: null }),
    changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    getBlob,
    hasBlob: async () => false,
    putBlob: async () => {
      throw new EngineError('offline', 'sample upload stop')
    },
  } as unknown as EngineClient
  const originalList = fs.list.bind(fs)
  const list = async function* () {
    if (block === 'inventory') {
      entered()
      await blocked
    }
    yield* originalList()
  }
  const engine = new SyncEngine({
    fs: Object.assign(fs, { fingerprint, list }),
    state,
    client,
    selective: selectiveDefaults(),
  })
  const work = engine.sync().catch((error) => error)
  try {
    await Promise.race([
      fingerprinting,
      work.then((error) => {
        throw error ?? new Error('Sync ended before local fingerprint')
      }),
    ])
    expect(await fs.stat('remote.md')).not.toBeNull()
    expect(await fs.read('remote.md')).toEqual(remote)
  } finally {
    release()
    await work
    await engine.stop()
  }
}
