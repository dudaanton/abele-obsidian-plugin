// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { MemoryStateStore, SyncEngine, sha256, type EngineClient } from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { selectiveFrom } from '@/sync/connection'
import { buildFakeVault } from '../helpers/fakeVault'
import { withDesktopFs } from '../helpers/fakeDesktopFs'

let longestStartupGap = Infinity
let localPathsYielded = false

it('starts a synced 33k indexed vault without content reads or a per-file disk walk', async () => {
  const count = 33000
  const paths = Array.from({ length: count }, (_, i) => `sample-${String(i).padStart(5, '0')}.md`)
  const app = buildFakeVault(paths.map((path) => ({ path, content: 'x', mtime: 1000 })))
  const indexed = new Set(paths)
  // The shared fake searches every filename for a missing case-insensitive path.
  // A static ASCII scale fixture models filesystem metadata lookup in constant time;
  // otherwise a missing journal file alone adds an artificial renderer-length task.
  app.vault.adapter.stat = async (path) =>
    indexed.has(path)
      ? { type: 'file', size: 1, mtime: 1000, ctime: 1000 }
      : path === '' || path === '/'
        ? { type: 'folder', size: 0, mtime: 0, ctime: 0 }
        : null
  const content = vi.spyOn(app.vault.adapter, 'readBinary')
  withDesktopFs(app)
  Object.assign(app.metadataCache, { initialized: true, isCacheClean: () => true })
  const state = new MemoryStateStore()
  const sha = await sha256(new Uint8Array([120]))
  const entries = paths.map((path) => ({
    path,
    wirePath: path,
    fileId: path,
    versionId: 'v1',
    sha,
    size: 1,
    mtime: 1000,
  }))
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  let phase = 'initialization'
  // Populate a read-only synced baseline without quadratic fixture insertion costs.
  state.all = async function* () {
    const caller = new Error().stack?.split('\n').slice(2, 5).join(' ')
    phase = 'state iteration: ' + caller
    const refresh = caller?.includes('refreshLocalPaths')
    const checkpoint = refresh ? setTimeout(() => (localPathsYielded = true), 0) : undefined
    try {
      yield* entries
    } finally {
      if (checkpoint !== undefined) clearTimeout(checkpoint)
    }
    phase = 'after state iteration: ' + caller
  }
  state.get = async (path) => byPath.get(path) ?? null
  state.byFileId = async (path) => byPath.get(path) ?? null
  await state.setCursor(1)
  const fs = new ObsidianFileSystem(app as never, { ledger: state })
  const list = fs.list.bind(fs)
  fs.list = async function* () {
    phase = 'file inventory'
    yield* list()
    phase = 'after file inventory'
  }
  for (const entry of entries)
    await state.setMeta(
      'paired-file:' + entry.path,
      JSON.stringify({ ...entry, identity: await fs.fileIdentity!(entry.path) })
    )
  content.mockClear()
  const stats = vi.spyOn(app.vault.adapter, 'stat')
  const lists = vi.spyOn(app.vault.adapter, 'list')
  const transfers = vi.fn(() => {
    throw new Error('Unexpected transfer')
  })
  let firstRequestMs = -1
  const started = performance.now()
  const client = {
    state: async () => {
      firstRequestMs = performance.now() - started
      return {
        head_seq: 1,
        settings: {
          conflict: 'merge',
          max_file_bytes: 1000000,
          quota_bytes: null,
          retention: { notes_days: 30, attachments_days: 30, settings_days: 30 },
        },
      }
    },
    changes: async () => ({ items: [], head_seq: 1, next_since: 1 }),
    manifest: transfers,
    commit: transfers,
    commitRaw: transfers,
    getBlob: transfers,
    putBlob: transfers,
  } as unknown as EngineClient
  const engine = new SyncEngine({ fs, state, client, selective: selectiveFrom(undefined) })
  let longestMs = 0,
    last = performance.now()
  const gaps: { ms: number; phase: string; at: number }[] = []
  const timer = setInterval(() => {
    const now = performance.now()
    longestMs = Math.max(longestMs, now - last)
    if (now - last >= 50) gaps.push({ ms: now - last, phase, at: last })
    last = now
  }, 0)
  try {
    await engine.sync()
    await new Promise((resolve) => setTimeout(resolve, 0))
    console.info(
      '[startup 33k]',
      JSON.stringify({
        files: count,
        firstRequestMs,
        elapsedMs: performance.now() - started,
        statCalls: stats.mock.calls.length,
        listCalls: lists.mock.calls.length,
        contentCalls: content.mock.calls.length,
        longestMs,
        gaps,
      })
    )
    expect(content).not.toHaveBeenCalled()
    expect(transfers).not.toHaveBeenCalled()
    expect(stats.mock.calls.length).toBeLessThan(256)
    expect(lists.mock.calls.length).toBeLessThan(32)
    expect(firstRequestMs).toBeGreaterThanOrEqual(0)
    expect(firstRequestMs).toBeLessThan(5000)
    longestStartupGap = longestMs
  } finally {
    clearInterval(timer)
    await engine.stop()
  }
}, 120000)

it('startup local-path refresh yields and keeps every task below 50 ms', () => {
  expect(longestStartupGap).toBeLessThan(50)
  expect(localPathsYielded).toBe(true)
})
