// @vitest-environment node
import '../helpers/desktopRequire'
import { expect, it, vi } from 'vitest'
import { promises as disk } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  EngineError,
  MemoryStateStore,
  SyncEngine,
  sha256,
  type ChunkSource,
  type EngineClient,
} from '@abele/sync-sdk/core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { selectiveFrom } from '@/sync/connection'
import { ScopeMarks } from '../../node_modules/@abele/sync-sdk/dist/internal/core/scope.js'
import { buildFakeVault } from '../helpers/fakeVault'

it('profiles native resume phases and reaches upload within five seconds with 33k tracked files and an unready index', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-replay-')))
  const tracked = 33000
  const paths = Array.from({ length: tracked + 1 }, (_, i) => `Shared/Notes/Sample ${i}.bin`)
  const target = paths.at(-1)!,
    bytes = new Uint8Array(3 * 1024 * 1024).fill(17)
  let engine: SyncEngine | undefined
  try {
    for (const folder of new Set(paths.map(dirname)))
      await disk.mkdir(join(root, folder), { recursive: true })
    for (let at = 0; at < paths.length; at += 64)
      await Promise.all(
        paths
          .slice(at, at + 64)
          .map((path) => disk.writeFile(join(root, path), path === target ? bytes : 'x'))
      )
    const app = buildFakeVault(
      paths.map((path) => ({ path, content: 'x', mtime: 1000 })),
      { sensitiveNames: true }
    )
    Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
    let lstats = 0,
      listings = 0
    Object.assign(app.vault.adapter, {
      getFullPath: (path: string) => join(root, path),
      fsPromises: {
        ...disk,
        readdir: async (...args: Parameters<typeof disk.readdir>) => {
          listings++
          return disk.readdir(...args)
        },
        lstat: async (...args: Parameters<typeof disk.lstat>) => {
          lstats++
          return disk.lstat(...args)
        },
      },
      stat: async (path: string) => {
        try {
          const value = await disk.stat(join(root, path))
          return {
            type: value.isFile() ? 'file' : 'folder',
            size: value.size,
            mtime: value.mtimeMs,
            ctime: value.birthtimeMs,
          }
        } catch (error) {
          if ((error as { code: string }).code === 'ENOENT') return null
          throw error
        }
      },
      list: async (path: string) => {
        listings++
        const entries = await disk.readdir(join(root, path), { withFileTypes: true })
        return {
          files: entries
            .filter((one) => one.isFile())
            .map((one) => [path, one.name].filter(Boolean).join('/')),
          folders: entries
            .filter((one) => one.isDirectory())
            .map((one) => [path, one.name].filter(Boolean).join('/')),
        }
      },
    })
    const state = new MemoryStateStore(),
      baseSha = await sha256(new TextEncoder().encode('x'))
    const fs = new ObsidianFileSystem(app as never, { ledger: state, fileScope: 'Shared' })
    // A restarted current ledger already has scope provenance. Without it this
    // fixture also requests the legacy migration's separate full presence check.
    await new ScopeMarks(state).record(
      fs,
      { selective: selectiveFrom(undefined), scriptsFolder: 'Scripts' },
      { excluded: () => false }
    )
    for (const path of paths.slice(0, -1)) {
      const info = await fs.stat(path)
      const entry = {
        path,
        wirePath: path,
        fileId: path,
        versionId: 'v1',
        sha: baseSha,
        size: 1,
        mtime: info!.mtime,
      }
      await state.put(entry)
      await state.setMeta(
        'paired-file:' + path,
        JSON.stringify({ ...entry, identity: await fs.fileIdentity!(path) })
      )
    }
    await state.setCursor(tracked)
    await state.setJournal({
      batchId: 'sample-batch',
      idempotencyKey: 'sample-request',
      startedAt: new Date().toISOString(),
      ops: [
        { op: 'create', path: target, sha: await sha256(bytes), size: bytes.length, mtime: 1000 },
      ],
    })
    const phases: { phase: string; ms: number }[] = []
    let phaseStarted = 0
    const phase = (name: string) => {
      const now = performance.now()
      phases.push({ phase: name, ms: now - phaseStarted })
      phaseStarted = now
    }
    let uploadMs = Infinity
    const upload = vi.fn(async (_identity: unknown, source: ChunkSource) => {
      uploadMs = performance.now() - started
      phase('replay source and upload scheduling')
      await source.close()
      throw new EngineError('offline', 'sample interruption at upload request')
    })
    const client = {
      state: async () => ({
        head_seq: tracked,
        settings: { max_file_bytes: 1e9, quota_bytes: null },
      }),
      hasBlob: async () => false,
      putBlobSource: upload,
    } as unknown as EngineClient
    let scheduledMs = 0,
      checkpoints = 0
    const recovery = fs.recoverConditionalFiles.bind(fs)
    fs.recoverConditionalFiles = async () => {
      phase('initial state setup')
      try {
        return await recovery()
      } finally {
        phase('conditional recovery')
      }
    }
    engine = new SyncEngine({
      fs,
      state,
      client,
      selective: selectiveFrom(undefined),
      yieldTask: async () => {
        const at = performance.now()
        await new Promise((resolve) => setTimeout(resolve, 0))
        scheduledMs += performance.now() - at
        checkpoints++
      },
    })
    const cycle = Reflect.get(engine, 'cycle') as {
      scanWork<T>(work: () => Promise<T>): Promise<T>
    }
    const scanWork = cycle.scanWork.bind(cycle)
    let scans = 0
    cycle.scanWork = async (work) => {
      const name = scans++ === 0 ? 'inventory' : 'reconciliation'
      phase(scans === 1 ? 'state, scope and recovery setup' : 'between scans')
      try {
        return await scanWork(work)
      } finally {
        phase(name)
      }
    }
    lstats = 0
    listings = 0
    const started = performance.now()
    phaseStarted = started
    await engine.sync().catch(() => {})
    console.log('native replay 33k', {
      uploadMs,
      lstats,
      listings,
      phases,
      scheduledMs,
      checkpoints,
    })
    expect(upload).toHaveBeenCalledOnce()
    expect(uploadMs).toBeLessThan(5000)
    expect(listings).toBeLessThan(20)
    expect(await state.getJournal()).not.toBeNull()
  } finally {
    await engine?.stop()
    await disk.rm(root, { recursive: true, force: true })
  }
}, 120000)
