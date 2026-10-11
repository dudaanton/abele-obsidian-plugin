import type { DataAdapter } from 'obsidian'
import { EngineError } from '@abele/sync-core'
import { sha256 } from '@noble/hashes/sha2'

interface NodeFsPromises {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  unlink(path: string): Promise<void>
  stat(path: string): Promise<{ dev: number; ino: number }>
  rename(from: string, to: string): Promise<void>
  rmdir(path: string): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  link(from: string, to: string): Promise<void>
  open(
    path: string,
    flags: string
  ): Promise<{
    read(
      bytes: Uint8Array,
      offset: number,
      length: number,
      position: number
    ): Promise<{ bytesRead: number }>
    close(): Promise<void>
  }>
}
export interface NativeFs {
  /** Retain the displaced inode outside the vault, including late writes through open handles. */
  archiveBackup?(path: string): Promise<string>
  rename(from: string, to: string): Promise<void>
  rmdirEmpty(folder: string): Promise<void>
  /** Final comparison and replacement share Obsidian's local-save queue. */
  replaceFenced?: (temp: string, target: string, before: ArrayBuffer | null) => Promise<void>
  /** Atomic create-if-unoccupied, never overwrite a locally recreated target. */
  installExclusive?: (from: string, to: string) => Promise<void>
  replaceFencedIdentity?: (
    temp: string,
    target: string,
    before: { size: number; sha: string }
  ) => Promise<void>
}

/** Optional native capabilities; mobile remains adapter-only, never a Node import. */
export function nativeOf(
  adapter: DataAdapter,
  assertEffect: (paths?: readonly string[]) => void = () => {}
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
      assertEffect([from, to])
      await rename(at(from), at(to))
      await reconcile(from, to)
    },
    async rmdirEmpty(path) {
      assertEffect([path])
      await rmdir(at(path))
      await reconcile(path)
    },
  }
  if (fsp.mkdir && fsp.stat && fsp.link && fsp.unlink) {
    const hex = (value: string) =>
      Array.from(sha256(new TextEncoder().encode(value)), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('')
    const root = at('').replace(/\\/g, '/').replace(/\/+$/, '')
    const folder = root.slice(0, root.lastIndexOf('/')) + '/.abele-sync-recovery/' + hex(root)
    native.archiveBackup = async (path) => {
      assertEffect([path])
      const source = at(path),
        destination = folder + '/' + hex(source) + '.old'
      await fsp.mkdir(folder, { recursive: true })
      try {
        await fsp.link(source, destination)
      } catch (error) {
        const code = (error as { code?: string }).code
        if (code !== 'EEXIST' && code !== 'ENOENT') throw error
        const retained = await fsp.stat(destination)
        try {
          const current = await fsp.stat(source)
          if (current.dev !== retained.dev || current.ino !== retained.ino)
            throw new EngineError('conflict', 'Recovery destination is occupied by another inode')
        } catch (missing) {
          if ((missing as { code?: string }).code !== 'ENOENT') throw missing
        }
      }
      assertEffect([path])
      try {
        await fsp.unlink(source)
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOENT') throw error
      }
      await reconcile(path)
      return destination
    }
  }
  if (typeof raw.queue === 'function' && typeof fsp.open === 'function') {
    const queue = raw.queue.bind(adapter),
      open = fsp.open.bind(fsp)
    native.replaceFencedIdentity = async (temp, target, before) => {
      await queue(async () => {
        const handle = await open(at(target), 'r')
        try {
          const bytes = new Uint8Array(1024 * 1024),
            hash = sha256.create()
          let size = 0
          for (;;) {
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, size)
            if (!bytesRead) break
            size += bytesRead
            hash.update(bytes.subarray(0, bytesRead))
          }
          const digest = Array.from(hash.digest(), (value) =>
            value.toString(16).padStart(2, '0')
          ).join('')
          if (size !== before.size || digest !== before.sha)
            throw new EngineError('conflict', `${target} changed before queued replacement`)
          assertEffect([temp, target])
          await rename(at(temp), at(target))
          await reconcile(temp, target)
        } finally {
          await handle.close()
        }
      })
    }
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
          assertEffect([temp, target])
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
      assertEffect([from, to])
      await link(at(from), at(to))
      // The source name remains journal-owned until completion; never weaken exclusive
      // installation by replacing an occupied destination with a rename.
      await reconcile(to)
    }
  }
  return native
}
