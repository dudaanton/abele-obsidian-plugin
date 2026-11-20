import { expect, it, vi } from 'vitest'
import {
  MemoryStateStore,
  SyncEngine,
  selectiveDefaults,
  sha256,
  type EngineClient,
} from '@abele/sync-sdk/core'
import type { CommitOp } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

async function fixture() {
  const app = buildFakeVault([
    { path: 'sample.md', content: 'sample', mtime: 1 },
    { path: 'stable.md', content: 'already synced', mtime: 1 },
  ])
  withDesktopFs(app)
  Object.assign(app.workspace, { layoutReady: true })
  let clean = true
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => clean })
  const state = new MemoryStateStore()
  await state.setCursor(1)
  await state.put({
    path: 'stable.md',
    wirePath: 'stable.md',
    fileId: 'stable',
    versionId: 'stable-v1',
    sha: await sha256(new TextEncoder().encode('already synced')),
    size: 14,
    mtime: 1,
  })
  const fs = new ObsidianFileSystem(app as never, {
    ledger: state,
    prepareStartupInventory: async () => {},
  })
  const commits: CommitOp[] = []
  const logs: string[] = []
  const client = {
    subscribe: () => () => {},
    manifest: async () => ({ items: [], head_seq: 1, next: null }),
    state: async () => ({
      head_seq: 1,
      settings: {
        conflict: 'merge',
        max_file_bytes: 1000000,
        quota_bytes: null,
        retention: { notes_days: 30, attachments_days: 30, settings_days: 30 },
      },
    }),
    changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    versions: async () => [],
    hasBlob: vi.fn(async () => true),
    getBlob: vi.fn(async () => {
      throw Error('unexpected download')
    }),
    commitRaw: vi.fn(async (ops: CommitOp[]) => {
      commits.push(...ops)
      return {
        replayed: false,
        body: {
          head_seq: 1,
          results: ops.map((op, n) => ({
            status: 'applied',
            seq: 1,
            file_id: 'file_id' in op ? op.file_id : `new-${commits.length}-${n}`,
            version_id: `v-${commits.length}-${n}`,
            path: 'path' in op ? op.path : 'restored.md',
            sha: 'sha' in op ? op.sha : null,
            size: 'size' in op ? op.size : 0,
            mtime: 'mtime' in op ? op.mtime : 0,
          })),
        },
      }
    }),
  }
  const engine = new SyncEngine({
    fs,
    state,
    client: client as unknown as EngineClient,
    selective: selectiveDefaults(),
    deleteGuard: false,
    log: (line) => logs.push(line),
  })
  return {
    app,
    fs,
    state,
    client,
    engine,
    commits,
    logs,
    dirty: (value: boolean) => {
      clean = !value
    },
  }
}

it.each(['comparison', 'upload', 'download'] as const)(
  'survives an empty and partially refilled host index during %s',
  async (phase) => {
    const s = await fixture()
    const bytes = new TextEncoder().encode('remote sample')
    const sha = await sha256(bytes)
    const files = s.app.vault.getFiles.bind(s.app.vault)
    const lookup = s.app.vault.getAbstractFileByPath.bind(s.app.vault)
    let rebuilding = false
    let partial = false
    let rebuilds = 0
    let refill: ReturnType<typeof setTimeout> | undefined
    let partialRefill: ReturnType<typeof setTimeout> | undefined
    const rebuild = () => {
      if (rebuilds++) return
      rebuilding = true
      s.dirty(true)
      // Disk is untouched. No delete events accompany cache eviction.
      partialRefill = setTimeout(() => {
        partial = true
      }, 10)
      refill = setTimeout(() => {
        rebuilding = false
        s.dirty(false)
      }, 25)
    }
    vi.spyOn(s.app.vault, 'getFiles').mockImplementation(() => {
      if (phase === 'comparison' && rebuilds === 0) rebuild()
      return rebuilding ? (partial ? files().slice(0, 1) : []) : files()
    })
    vi.spyOn(s.app.vault, 'getAbstractFileByPath').mockImplementation((path) =>
      rebuilding && path !== '' ? null : lookup(path)
    )
    if (phase === 'upload')
      s.client.hasBlob.mockImplementation(async () => {
        rebuild()
        return true
      })
    else if (phase === 'download') {
      let delivered = false
      s.client.changes = async () => {
        if (delivered) return { items: [], head_seq: 2, next_since: 2 }
        delivered = true
        return {
          items: [
            {
              seq: 2,
              op: 'create',
              file_id: 'remote',
              version_id: 'remote-v1',
              path: 'remote.md',
              prev_path: null,
              sha,
              size: bytes.length,
              mtime: 2,
            },
          ],
          head_seq: 2,
          next_since: 2,
        } as never
      }
      s.client.getBlob.mockImplementation(async () => {
        rebuild()
        return bytes as never
      })
    }
    try {
      await s.engine.sync()
      await s.engine.sync()
      expect(rebuilds).toBeGreaterThan(0)
      expect(s.engine.status.lastError, s.logs.join('\n')).toBeNull()
      expect(s.commits).toHaveLength(1)
      expect(s.commits[0]).toMatchObject({ op: 'create', path: 'sample.md' })
      expect(await s.app.vault.adapter.read('sample.md')).toBe('sample')
      expect(await s.app.vault.adapter.read('stable.md')).toBe('already synced')
      expect(s.client.getBlob).toHaveBeenCalledTimes(phase === 'download' ? 1 : 0)
      if (phase === 'download')
        expect(await s.app.vault.adapter.readBinary('remote.md')).toEqual(bytes.buffer)
    } finally {
      if (refill) clearTimeout(refill)
      if (partialRefill) clearTimeout(partialRefill)
      s.dirty(false)
      await s.engine.stop()
    }
  }
)
