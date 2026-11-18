import { shallowRef } from 'vue'
import type { FileInfo } from '@abele/sync-sdk/core'
import type { VaultCheckItem, VaultCheckSource, VaultCheckState } from './vaultCheck'

export interface CheckFile {
  path: string
  sha: string
  size: number
}
/** Read-only ports: listing never prepares, reconciles or acknowledges the sync engine. */
export interface VaultCheckHost {
  withInventory?(work: () => Promise<void>): Promise<void>
  localRevision?(): unknown
  local(signal: AbortSignal): Promise<FileInfo[]>
  remote(signal: AbortSignal): Promise<{ revision: string; files: CheckFile[] }>
  revision(signal: AbortSignal): Promise<string>
  fingerprint(path: string, signal: AbortSignal): Promise<{ sha: string; size: number }>
  unchanged(file: FileInfo): Promise<boolean>
  excluded(path: string, size: number): boolean
  pending(path: string, sha: string): Promise<boolean>
  send(path: string): Promise<void>
}

export function createVaultCheck(
  host: VaultCheckHost
): VaultCheckSource & { run(): Promise<void> } {
  const state = shallowRef<VaultCheckState>({ kind: 'never' })
  let controller: AbortController | undefined
  let active: Promise<void> | undefined
  const source = {
    state,
    start: () => {
      void source.run()
    },
    stop: () => {
      controller?.abort()
      const s = state.value
      if (s.kind === 'running')
        state.value = { kind: 'stopped', done: s.done, total: s.total, at: Date.now() }
    },
    send: async (path: string) => {
      const s = state.value
      if (
        s.kind !== 'differs' ||
        !s.items.some((item) => item.path === path && item.reason === 'unsent')
      )
        throw new Error('This file is not waiting to be sent')
      await host.send(path)
    },
    run: (): Promise<void> => {
      if (active !== undefined)
        return controller?.signal.aborted ? active.then(() => source.run()) : active
      controller = new AbortController()
      const signal = controller.signal
      state.value = { kind: 'running', done: 0, total: 0, bytesDone: 0, bytesTotal: 0 }
      const work = async () => {
        try {
          const localRevision = host.localRevision?.()
          const local = await host.local(signal)
          signal.throwIfAborted()
          const remote = await host.remote(signal)
          signal.throwIfAborted()
          const server = new Map(remote.files.map((file) => [file.path.normalize('NFC'), file]))
          if (server.size !== remote.files.length) throw new Error('Ambiguous server inventory')
          const names = new Set(local.map((file) => file.path.normalize('NFC')))
          if (names.size !== local.length) throw new Error('Ambiguous local inventory')
          const total = names.size + [...server.keys()].filter((path) => !names.has(path)).length
          const bytesTotal = local.reduce((sum, file) => sum + file.size, 0)
          let bytes = 0
          let done = 0
          const items: VaultCheckItem[] = []
          for (const file of local) {
            signal.throwIfAborted()
            state.value = {
              kind: 'running',
              total,
              done,
              bytesDone: bytes,
              bytesTotal,
              current: file.path,
            }
            const other = server.get(file.path.normalize('NFC'))
            // Even excluded content is read: the check covers every local file, not the ledger.
            const content = await host.fingerprint(file.path, signal)
            signal.throwIfAborted()
            if (!(await host.unchanged(file)) || content.size !== file.size)
              throw new Error('Local inventory changed during the check')
            if (host.excluded(file.path, file.size))
              items.push({ path: file.path, reason: 'skipped' })
            else if (!other || content.sha !== other.sha || content.size !== other.size) {
              items.push({
                path: file.path,
                reason: (await host.pending(file.path, content.sha))
                  ? 'unsent'
                  : other
                    ? 'differs'
                    : 'local-only',
              })
            }
            signal.throwIfAborted()
            bytes += content.size
            done++
            state.value = {
              kind: 'running',
              total,
              done,
              bytesDone: bytes,
              bytesTotal,
              current: file.path,
            }
          }
          for (const file of remote.files) {
            if (names.has(file.path.normalize('NFC'))) continue
            items.push({
              path: file.path,
              reason: host.excluded(file.path, file.size) ? 'skipped' : 'server-only',
            })
            done++
          }
          signal.throwIfAborted()
          state.value = { kind: 'running', total, done, bytesDone: bytes, bytesTotal }
          if ((await host.revision(signal)) !== remote.revision)
            throw new Error('Server inventory changed during the check')
          // Detect edits to files already hashed, and names added/removed during the run.
          const after = await host.local(signal)
          const beforeByPath = new Map(local.map((file) => [file.path, file]))
          if (
            after.length !== local.length ||
            after.some((file) => {
              const before = beforeByPath.get(file.path)
              return (
                !before ||
                before.size !== file.size ||
                before.mtime !== file.mtime ||
                before.ctime !== file.ctime
              )
            })
          )
            throw new Error('Local inventory changed during the check')
          signal.throwIfAborted()
          if (localRevision !== host.localRevision?.())
            throw new Error('Local inventory revision changed')
          state.value = items.length
            ? { kind: 'differs', total, bytes, at: Date.now(), items }
            : { kind: 'matched', total, bytes, at: Date.now() }
        } catch (error) {
          if (!signal.aborted) {
            console.debug('[abele-sync] vault check did not complete', error)
            state.value = { kind: 'unreachable', at: Date.now() }
          }
        }
      }
      active = (async () => {
        try {
          if (host.withInventory) await host.withInventory(work)
          else await work()
        } catch (error) {
          if (!signal.aborted) {
            console.debug('[abele-sync] vault check inventory did not complete', error)
            state.value = { kind: 'unreachable', at: Date.now() }
          }
        } finally {
          active = undefined
        }
      })()
      return active
    },
  }
  return source
}
