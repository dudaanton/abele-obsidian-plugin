import type { FileSystem, StateEntry } from '@abele/sync-sdk/core'
import { fingerprintSource } from '@abele/sync-sdk/core'
import { V2Client, decodeAccessToken } from './v2/client'
import { createVaultCheck, type CheckFile } from './vaultCheckEngine'
import { sha256 } from './external/hash'
import { SyncTaskBudget, yieldSyncTask } from './syncTaskBudget'
import { RESTORE_HEADER } from './restoreFence'

export function runtimeVaultCheck(options: {
  fs: FileSystem
  encoded: string
  item?: string
  fetch: typeof fetch
  localPath(path: string): string
  excluded(path: string, size: number): boolean
  exclusionFact?(path: string, size: number): 'audio' | 'rule'
  entry(path: string): Promise<StateEntry | null>
  pending?(path: string, sha: string): Promise<boolean>
  send(path: string): Promise<void>
}) {
  const token = decodeAccessToken(options.encoded)
  const pageReader = (signal: AbortSignal) => {
    let generation = ''
    // This client has no engine ports: read decoding cannot settle departures or write state.
    const client = new V2Client(
      token,
      async (input, init) => {
        const response = await options.fetch(input, { ...init, signal })
        const observed = response.headers.get(RESTORE_HEADER) ?? ''
        if (generation && observed !== generation) throw new Error('Server generation changed')
        generation = observed
        return response
      },
      options.item
    )
    return { client, generation: () => generation }
  }
  return createVaultCheck({
    withInventory: (work) => {
      const inventory = Reflect.get(options.fs, Symbol.for('abele.sync.inventory-pass-v1'))
      return inventory ? inventory.call(options.fs, work) : work()
    },
    localRevision: () => {
      const id = Reflect.get(options.fs, Symbol.for('abele.sync.inventory-id-v1'))?.call(options.fs)
      const revision = Reflect.get(
        options.fs,
        Symbol.for('abele.sync.local-change-revision-v1')
      )?.call(options.fs)
      return `${id}:${revision}`
    },
    local: async (signal) => {
      const files = []
      for await (const file of options.fs.list()) {
        signal.throwIfAborted()
        files.push(file)
        if (files.length % 128 === 0) await yieldSyncTask()
      }
      return files
    },
    remote: async (signal) => {
      const reader = pageReader(signal)
      const files: CheckFile[] = []
      let next: string | null = null
      let cursor: number | undefined
      const cursors = new Set<string>()
      do {
        const page = await reader.client.manifest(next)
        if (cursor !== undefined && cursor !== page.cursor)
          throw new Error('Server inventory changed')
        cursor = page.cursor
        for (const item of page.items)
          if (item.kind !== 'directory')
            files.push({ path: options.localPath(item.path), sha: item.sha, size: item.size })
        next = page.next
        if (next && cursors.has(next)) throw new Error('Repeated server inventory page')
        if (next) cursors.add(next)
        await yieldSyncTask()
      } while (next !== null)
      return { files, revision: `${reader.generation()}:${cursor}` }
    },
    revision: async (signal) => {
      const reader = pageReader(signal)
      const page = await reader.client.manifest()
      return `${reader.generation()}:${page.cursor}`
    },
    fingerprint: async (path, signal) => {
      // Deliberately bypass fingerprint() and its verified inventory hash cache.
      if (options.fs.openRead) {
        const source = await options.fs.openRead(path)
        const budget = new SyncTaskBudget()
        return fingerprintSource(
          {
            size: source.size,
            read: async (offset, length, readSignal) => {
              await budget.account(length, readSignal)
              return source.read(offset, length, readSignal)
            },
            assertUnchanged: () => source.assertUnchanged(),
            close: () => source.close(),
          },
          64 * 1024,
          signal
        )
      }
      signal.throwIfAborted()
      const bytes = await options.fs.read(path)
      return { sha: await sha256(bytes), size: bytes.byteLength }
    },
    unchanged: async (file) => {
      const after = await options.fs.stat(file.path)
      return (
        !!after &&
        after.size === file.size &&
        after.mtime === file.mtime &&
        after.ctime === file.ctime
      )
    },
    excluded: (path, size) => options.excluded(path, size),
    exclusionFact: (path, size) => options.exclusionFact?.(path, size) ?? 'rule',
    pending: async (path, sha) => {
      if (options.pending) return options.pending(path, sha)
      const entry = await options.entry(path)
      return !!entry && entry.sha !== sha
    },
    send: (path) => options.send(path),
  })
}
