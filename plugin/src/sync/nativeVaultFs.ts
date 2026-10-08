import type { DataAdapter } from 'obsidian'
import { EngineError } from '@abele/sync-core'

interface NodeFsPromises {
  rename(from: string, to: string): Promise<void>
  rmdir(path: string): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  link(from: string, to: string): Promise<void>
}
export interface NativeFs {
  rename(from: string, to: string): Promise<void>
  rmdirEmpty(folder: string): Promise<void>
  /** Final comparison and replacement share Obsidian's local-save queue. */
  replaceFenced?: (temp: string, target: string, before: ArrayBuffer | null) => Promise<void>
  /** Atomic create-if-unoccupied, never overwrite a locally recreated target. */
  installExclusive?: (from: string, to: string) => Promise<void>
}

/** Optional native capabilities; mobile remains adapter-only, never a Node import. */
export function nativeOf(
  adapter: DataAdapter,
  assertEffect: () => void = () => {}
): NativeFs | null {
  const raw = adapter as unknown as {
    fsPromises?: Partial<NodeFsPromises>
    getFullPath?: (path: string) => string
    reconcileInternalFile?: (path: string) => Promise<void>
    queue?: <T>(operation: () => Promise<T>) => Promise<T>
  }
  const fsp = raw.fsPromises,
    full = raw.getFullPath
  if (
    typeof full !== 'function' ||
    !fsp ||
    typeof fsp.rename !== 'function' ||
    typeof fsp.rmdir !== 'function'
  )
    return null
  const rename = fsp.rename.bind(fsp),
    rmdir = fsp.rmdir.bind(fsp)
  const at = (path: string) => full.call(adapter, path)
  const reconcile = async (...paths: string[]) => {
    if (!raw.reconcileInternalFile) return
    for (const path of paths) {
      try {
        await raw.reconcileInternalFile.call(adapter, path)
      } catch (error) {
        console.debug(`[abele-sync] Obsidian did not look at ${path} again`, error)
      }
    }
  }
  const native: NativeFs = {
    async rename(from, to) {
      assertEffect()
      await rename(at(from), at(to))
      await reconcile(from, to)
    },
    async rmdirEmpty(path) {
      assertEffect()
      await rmdir(at(path))
      await reconcile(path)
    },
  }
  if (typeof raw.queue === 'function' && typeof fsp.readFile === 'function') {
    const queue = raw.queue.bind(adapter),
      read = fsp.readFile.bind(fsp)
    native.replaceFenced = async (temp, target, before) => {
      try {
        await queue(async () => {
          // Use raw native reads inside the queue: adapter.readBinary would re-enter it.
          if (before !== null) {
            const current = new Uint8Array(await read(at(target))),
              expected = new Uint8Array(before)
            if (
              current.length !== expected.length ||
              current.some((value, i) => value !== expected[i])
            ) {
              throw new EngineError('conflict', `${target} changed before queued replacement`)
            }
          }
          assertEffect()
          await rename(at(temp), at(target))
          await reconcile(temp, target)
        })
      } catch (cause) {
        if (cause instanceof EngineError) throw cause
        throw new EngineError('io', `cannot replace ${target} in the local-save queue`, cause)
      }
    }
  }
  if (typeof fsp.link === 'function') {
    const link = fsp.link.bind(fsp)
    native.installExclusive = async (from, to) => {
      assertEffect()
      await link(at(from), at(to))
      // The source name remains journal-owned until completion; never weaken exclusive
      // installation by replacing an occupied destination with a rename.
      await reconcile(to)
    }
  }
  return native
}
