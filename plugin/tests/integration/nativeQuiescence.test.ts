// @vitest-environment node
import '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import {
  MemoryStateStore,
  selectiveDefaults,
  SyncEngine,
  ExpectedWrites,
  pull,
  sha256,
  type EngineClient,
  type FileSystem,
} from '@abele/sync-sdk/core'
import { VaultSettingsSchema } from '@abele/sync-sdk/protocol'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { desktopFileIdentity } from '@/sync/desktopFileIdentity'
import { scopedFileSystem } from '@/sync/scopedFileSystem'
import { LocalFolderPlacement } from '@/sync/localFolderPlacement'
import { TaskCpu } from '../helpers/taskCpu'
import { buildFakeVault } from '../helpers/fakeVault'

// Keep wall latency diagnostic: the capped train can suspend this process between tasks.
async function measured<T>(work: () => Promise<T>) {
  const cpu = new TaskCpu()
  const started = performance.now()
  let result: T
  try {
    result = await work()
  } finally {
    cpu.stop()
  }
  return { result, cpu, ms: performance.now() - started }
}

it.each(['pull', 'upload'] as const)(
  'settles a watched 33000-file native vault after %s without another full filesystem pass or content read',
  async (phase) => {
    const timers = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] as const
    const previous = timers.map((key) => Object.getOwnPropertyDescriptor(window, key))
    for (const key of timers)
      Object.defineProperty(window, key, { configurable: true, value: globalThis[key] })
    const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-idle-vault-')))
    const count = 33000,
      state = new MemoryStateStore(),
      bytes = new Uint8Array([37]),
      sha = await sha256(bytes)
    const paths = Array.from({ length: count }, (_, i) => `Notes/Section ${i % 16}/Sample ${i}.bin`)
    let probes = 0,
      reads = 0,
      enumeratedEntries = 0
    const native = new Proxy(disk, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => {
          if (['stat', 'lstat', 'realpath', 'readdir'].includes(String(key))) probes++
          if (['readFile', 'open'].includes(String(key))) reads++
          const result = value.apply(target, args)
          if (key === 'readdir')
            return result.then((rows: unknown[]) => {
              enumeratedEntries += rows.length
              return rows
            })
          return result
        }
      },
    })
    let engine: SyncEngine | undefined
    try {
      for (let i = 0; i < 16; i++)
        await disk.mkdir(join(root, `Notes/Section ${i}`), { recursive: true })
      for (let offset = 0; offset < count; offset += 128)
        await Promise.all(
          paths.slice(offset, offset + 128).map(async (path, i) => {
            await disk.writeFile(join(root, path), bytes)
            await disk.utimes(join(root, path), 1, 1)
            if (offset + i === count - 1) return
            await state.setMeta(
              'paired-file:' + path,
              JSON.stringify({
                identity: desktopFileIdentity(await disk.stat(join(root, path), { bigint: true })),
                sha,
                size: 1,
                mtime: 1000,
              })
            )
            await state.put({
              path,
              wirePath: path,
              fileId: `sample-${offset + i}`,
              versionId: `version-${offset + i}`,
              sha,
              size: 1,
              mtime: 1000,
            })
          })
        )
      if (phase === 'pull') await disk.unlink(join(root, paths.at(-1)!))
      await state.setCursor(1)
      const app = buildFakeVault(paths.map((path) => ({ path, content: '%', mtime: 1000 })))
      Object.assign(app.metadataCache, { initialized: false, isCacheClean: () => false })
      Object.assign(app.vault.adapter, {
        getFullPath: (path: string) => join(root, path),
        fsPromises: native,
        stat: async (path: string) => {
          try {
            const stat = await native.stat(join(root, path))
            return {
              type: stat.isDirectory() ? 'folder' : 'file',
              size: stat.size,
              mtime: stat.mtimeMs,
              ctime: stat.birthtimeMs,
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
            throw error
          }
        },
        list: async (path: string) => {
          const rows = await native.readdir(join(root, path), { withFileTypes: true })
          return {
            files: rows
              .filter((row) => row.isFile())
              .map((row) => [path, row.name].filter(Boolean).join('/')),
            folders: rows
              .filter((row) => row.isDirectory())
              .map((row) => [path, row.name].filter(Boolean).join('/')),
          }
        },
      })
      const fs = new ObsidianFileSystem(app as never, { ledger: state, fileScope: 'Notes' })
      const includes = (path: string) => path === 'Notes' || path.startsWith('Notes/')
      const compose = (source: FileSystem) =>
        new LocalFolderPlacement('Notes', 'Notes').fileSystem(
          scopedFileSystem(
            source,
            (path) => {
              if (!includes(path)) throw new Error('Outside sample scope')
            },
            includes,
            undefined,
            'Notes'
          )
        )
      const coreFs = compose(fs)
      const tail = {
        path: paths.at(-1)!,
        file_id: `sample-${count - 1}`,
        version_id: `version-${count - 1}`,
        sha,
        size: 1,
        mtime: 1000,
        seq: 2,
        op: 'create',
        prev_path: null,
        kind: 'attachment',
      }
      let head = phase === 'pull' ? 2 : 1
      const client = {
        state: async () => ({ head_seq: head, settings: VaultSettingsSchema.parse({}), usage: {} }),
        manifest: async () => ({ items: [], head_seq: head, next: null }),
        changes: async (since: number) => ({
          items: head === 2 && since < 2 ? [tail] : [],
          head_seq: head,
          next_since: head,
        }),
        hasBlob: async () => false,
        putBlob: async () => {},
        getBlob: async () => bytes,
        commitRaw: async () => {
          head = 2
          return {
            replayed: false,
            body: { head_seq: head, results: [{ ...tail, status: 'applied' }] },
          }
        },
        subscribe: () => () => {},
      } as unknown as EngineClient
      let completed: import('@abele/sync-sdk/core').SyncReport | undefined
      let now = 1000
      engine = new SyncEngine({
        fs: coreFs,
        state,
        client,
        selective: selectiveDefaults(),
        now: () => now,
        onSync: (report) => {
          completed = report
        },
      })
      engine.start()
      await Reflect.get(engine, 'running')
      expect(engine.status.state).toBe('idle')
      expect((await state.get(paths.at(-1)!))?.versionId).toBe(tail.version_id)
      expect(phase === 'pull' ? completed?.pull.applied : completed?.push.applied).toBe(1)
      probes = reads = enumeratedEntries = 0
      const idle = await measured(() => engine!.sync())
      console.log('native idle cycle', {
        probes,
        reads,
        enumeratedEntries,
        ms: idle.ms,
        cpuMs: idle.cpu.totalMs,
      })
      expect(engine.status.state).toBe('idle')
      expect(probes).toBeLessThan(128)
      expect(reads).toBe(0)
      expect(enumeratedEntries).toBeLessThan(128)
      expect(idle.cpu.totalMs).toBeLessThan(5000)

      now += 300000
      probes = reads = enumeratedEntries = 0
      // Keep timer gaps as diagnostics, but cap synchronous task CPU below. The test
      // runner may suspend this process while enforcing a shared CPU allowance.
      let lastTurn = performance.now(),
        longestTaskBoundMs = 0
      const heartbeat = setInterval(() => {
        const at = performance.now()
        longestTaskBoundMs = Math.max(longestTaskBoundMs, at - lastTurn)
        lastTurn = at
      }, 1)
      const taskCpu = new TaskCpu()
      const inspectionStart = performance.now()
      const cpuStart = process.cpuUsage()
      let cpu: NodeJS.CpuUsage
      try {
        await engine.sync()
        await new Promise((resolve) => setTimeout(resolve, 2))
        cpu = process.cpuUsage(cpuStart)
      } finally {
        taskCpu.stop()
        clearInterval(heartbeat)
      }
      console.log('native periodic inspection', {
        probes,
        reads,
        enumeratedEntries,
        threadCpuMs: taskCpu.totalMs,
        ms: performance.now() - inspectionStart,
        cpuMs: (cpu.user + cpu.system) / 1000,
        longestTaskBoundMs,
        taskCpuMs: taskCpu.longestMs,
        taskWallMs: taskCpu.longestWallMs,
        tasks: taskCpu.tasks,
      })
      expect(taskCpu.longestMs).toBeLessThan(50)
      expect(probes).toBeGreaterThan(count)
      expect(reads).toBe(0)
      // A periodic cycle inventories files and directories: two probes/enumerations
      // per file plus fixed scope/private-directory work, never an extra full pass.
      expect(probes).toBeLessThan(count * 2 + 1024)
      expect(enumeratedEntries).toBeLessThan(count * 2 + 1024)
      expect(taskCpu.totalMs).toBeLessThan(5000)
      expect(engine.status.state).toBe('idle')

      let since = 0
      const changes = Array.from({ length: 34000 }, (_, i) => ({
        path: paths[i % count],
        file_id: `sample-${i % count}`,
        version_id: `version-${i % count}`,
        sha,
        size: 1,
        mtime: 1000,
        seq: i + 3,
        op: 'create',
        prev_path: null,
        kind: 'attachment',
      }))
      probes = reads = enumeratedEntries = 0
      const echoes = await measured(() =>
        pull(
          {
            ...client,
            changes: async () => {
              const items = changes.slice(since, since + 1000)
              since += items.length
              return { items, head_seq: 34002, next_since: items.at(-1)?.seq ?? 34002 }
            },
          } as EngineClient,
          coreFs,
          state,
          { filter: { excluded: () => false }, dirty: new Set(), expected: new ExpectedWrites() }
        )
      )
      const echo = echoes.result
      console.log('native own echoes', {
        probes,
        reads,
        enumeratedEntries,
        ms: echoes.ms,
        cpuMs: echoes.cpu.totalMs,
      })
      expect(echo.cursor).toBe(34002)
      expect(echo.applied).toBe(0)
      expect(probes).toBeLessThan(128)
      expect(reads).toBe(0)
      expect(enumeratedEntries).toBeLessThan(128)
      expect(echoes.cpu.totalMs).toBeLessThan(5000)
      await engine.stop()
      // Rebuild only the adapter/engine, retaining committed paired-file evidence.
      const restarted = new ObsidianFileSystem(app as never, { ledger: state, fileScope: 'Notes' })
      engine = new SyncEngine({
        fs: compose(restarted),
        state,
        client: {
          ...client,
          state: async () => ({
            head_seq: 34002,
            settings: VaultSettingsSchema.parse({}),
            usage: {},
          }),
          changes: async () => ({ items: [], head_seq: 34002, next_since: 34002 }),
        } as EngineClient,
        selective: selectiveDefaults(),
      })
      reads = 0
      await engine.sync()
      expect(reads).toBe(0)
      expect(engine.status.state).toBe('idle')
    } finally {
      await engine?.stop()
      await disk.rm(root, { recursive: true, force: true })
      for (const [i, key] of timers.entries()) {
        if (previous[i]) Object.defineProperty(window, key, previous[i]!)
        else Reflect.deleteProperty(window, key)
      }
    }
  },
  180000
)
