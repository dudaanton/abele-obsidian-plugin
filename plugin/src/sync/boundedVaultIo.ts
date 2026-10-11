import type { DataAdapter, Stat } from 'obsidian'
import {
  EngineError,
  MAX_CHUNK_BYTES,
  fingerprintSource,
  type ChunkSource,
  type SourceStamp,
} from '@abele/sync-core'
import { bytesOf } from './vaultWrites'
import { sha256 } from '@noble/hashes/sha2'

const PHONE_FALLBACK_BYTES = 50 * 1024 * 1024
interface Handle {
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesRead: number }>
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number
  ): Promise<{ bytesWritten: number }>
  sync(): Promise<void>
  close(): Promise<void>
}
export interface NativeChunkAdapter extends DataAdapter {
  getFullPath?(path: string): string
  fsPromises?: {
    open?(path: string, flags: string): Promise<Handle>
    utimes?(path: string, atime: number, mtime: number): Promise<void>
  }
}
interface MobileFiles {
  readFile(options: { path: string; offset: number; length: number }): Promise<{ data: string }>
  stat(options: { path: string }): Promise<{ size: number }>
  readFileInChunks?(
    options: { path: string; offset: number; length: number; chunkSize: number },
    callback: (chunk: { data: string } | null, error?: { message: string }) => void
  ): Promise<string>
}
const mobileFiles = (): MobileFiles | undefined =>
  typeof window === 'undefined'
    ? undefined
    : (window as unknown as { Capacitor?: { Plugins?: { Filesystem?: MobileFiles } } }).Capacitor
        ?.Plugins?.Filesystem
const stampOf = (stat: Stat): SourceStamp => ({
  size: stat.size,
  mtime: stat.mtime,
  generation: `${stat.size}:${stat.mtime}:${stat.ctime}`,
})
function decode(data: string, limit: number): Uint8Array {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  if (data.length % 4 || (data.length / 4) * 3 - padding > limit)
    throw new EngineError('io', 'Native filesystem ignored the bounded read')
  const binary = atob(data)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
/** Ranged chunk callbacks end at the empty chunk. Only one bridge call is outstanding. */
function readMobileChunk(
  files: MobileFiles,
  path: string,
  offset: number,
  length: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!files.readFileInChunks)
    return files.readFile({ path, offset, length }).then((result) => decode(result.data, length))
  return new Promise((resolve, reject) => {
    let received: Uint8Array | undefined
    let failed = false
    const cleanup = () => {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const refuse = (error: unknown) => {
      failed = true
      received = undefined
      cleanup()
      reject(
        error instanceof Error ? error : new Error('Native bounded read failed', { cause: error })
      )
    }
    const abort = () => refuse(signal?.reason ?? new Error('cancelled'))
    const timer = window.setTimeout(
      () => refuse(new EngineError('io', 'Native bounded read did not finish')),
      30000
    )
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    void files
      .readFileInChunks({ path, offset, length, chunkSize: length || 1 }, (chunk, error) => {
        if (failed) return
        try {
          if (error) throw new Error(error.message)
          if (!chunk || typeof chunk.data !== 'string') throw new Error('Invalid filesystem chunk')
          if (chunk.data === '') {
            failed = true
            cleanup()
            resolve(received ?? new Uint8Array())
            return
          }
          if (received) throw new EngineError('io', 'Native filesystem ignored the bounded range')
          received = decode(chunk.data, length)
        } catch (error) {
          refuse(error)
        }
      })
      .catch(refuse)
  })
}

/** Native capabilities are discovered on the adapter, without loading Node on mobile. */
export class BoundedVaultIo {
  private rangedMobile: Promise<MobileFiles | null> | undefined
  constructor(
    readonly adapter: DataAdapter,
    private readonly assertOwned: () => void = () => {},
    private readonly effect: <T>(work: () => T) => T = (work) => work()
  ) {}
  private get raw(): NativeChunkAdapter {
    return this.adapter
  }
  async requireTransfer(size: number): Promise<void> {
    if (size <= PHONE_FALLBACK_BYTES || (this.raw.fsPromises?.open && this.raw.getFullPath)) return
    if (!(await this.mobile()))
      throw new EngineError(
        'io',
        'Bounded file reads are unavailable; the fallback limit is 50 MiB'
      )
    if (typeof this.adapter.appendBinary !== 'function')
      throw new EngineError(
        'io',
        'Bounded staging writes are unavailable; the fallback limit is 50 MiB'
      )
  }
  private async stat(path: string): Promise<Stat> {
    this.assertOwned()
    const stat = await this.adapter.stat(path)
    this.assertOwned()
    if (!stat || stat.type !== 'file') throw new EngineError('io', `cannot read ${path}`)
    return stat
  }
  /** No Directory is supplied: getFullPath's absolute vault path is used by Capacitor.
   * Probe both mapping and offset/length against a tiny file, never against a large input. */
  private mobile(): Promise<MobileFiles | null> {
    return (this.rangedMobile ??= this.probeMobile())
  }
  private async probeMobile(): Promise<MobileFiles | null> {
    const files = mobileFiles()
    if ((!files?.readFile && !files?.readFileInChunks) || !files?.stat || !this.raw.getFullPath)
      return null
    const path = `.abele-sync-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}.tmp`
    let created = false
    try {
      if (await this.adapter.exists(path)) return null
      this.assertOwned()
      await this.adapter.writeBinary(path, new Uint8Array([11, 37, 89, 143]).buffer)
      created = true
      const absolute = this.raw.getFullPath(path)
      const stat = await files.stat({ path: absolute })
      const bytes = await readMobileChunk(files, absolute, 1, 2)
      if (stat.size !== 4 || bytes.length !== 2 || bytes[0] !== 37 || bytes[1] !== 89) return null
      console.debug('[abele-sync] native filesystem bounded ranges verified')
      return files
    } catch (error) {
      console.debug('[abele-sync] native filesystem ranges unavailable', error)
      return null
    } finally {
      if (created) {
        this.assertOwned()
        await this.adapter.remove(path)
      }
    }
  }
  async openRead(path: string, expected?: SourceStamp): Promise<ChunkSource> {
    const original = stampOf(await this.stat(path))
    if (expected && original.generation !== expected.generation)
      throw new EngineError('conflict', `${path} changed before opening`)
    const raw = this.raw
    const handle =
      raw.fsPromises?.open && raw.getFullPath
        ? await raw.fsPromises.open(raw.getFullPath(path), 'r')
        : null
    const files = handle ? null : await this.mobile()
    let fallback: Uint8Array | null = null
    if (!handle && !files) {
      if (original.size > PHONE_FALLBACK_BYTES)
        throw new EngineError(
          'io',
          'Bounded file reads are unavailable; the fallback limit is 50 MiB'
        )
      fallback = new Uint8Array(await this.adapter.readBinary(path))
    }
    let closed = false
    const unchanged = async () => {
      if (stampOf(await this.stat(path)).generation !== original.generation)
        throw new EngineError('conflict', `${path} changed while reading`)
    }
    return {
      size: original.size,
      stamp: original,
      read: async (offset, length, signal) => {
        signal?.throwIfAborted()
        this.assertOwned()
        if (
          closed ||
          !Number.isSafeInteger(offset) ||
          !Number.isSafeInteger(length) ||
          offset < 0 ||
          length < 0 ||
          length > MAX_CHUNK_BYTES ||
          offset + length > original.size
        )
          throw new EngineError('io', 'invalid bounded file read')
        if (length === 0) return new Uint8Array()
        let bytes: Uint8Array
        if (handle) {
          bytes = new Uint8Array(length)
          let received = 0
          while (received < length) {
            signal?.throwIfAborted()
            const { bytesRead } = await handle.read(
              bytes,
              received,
              length - received,
              offset + received
            )
            if (!bytesRead) throw new EngineError('io', 'truncated bounded file read')
            received += bytesRead
          }
        } else if (files) {
          bytes = await readMobileChunk(files, raw.getFullPath(path), offset, length, signal)
        } else bytes = fallback.slice(offset, offset + length)
        signal?.throwIfAborted()
        this.assertOwned()
        if (bytes.length !== length) throw new EngineError('io', 'truncated bounded file read')
        return bytes
      },
      assertUnchanged: unchanged,
      close: async () => {
        if (closed) return
        closed = true
        fallback = null
        await handle?.close()
      },
    }
  }
  async fingerprint(path: string, signal?: AbortSignal) {
    if (this.raw.fsPromises?.open && this.raw.getFullPath) {
      const before = stampOf(await this.stat(path))
      const handle = await this.raw.fsPromises.open(this.raw.getFullPath(path), 'r')
      try {
        const bytes = new Uint8Array(MAX_CHUNK_BYTES),
          hash = sha256.create()
        let size = 0
        for (;;) {
          signal?.throwIfAborted()
          this.assertOwned()
          const { bytesRead } = await handle.read(bytes, 0, bytes.length, size)
          if (!bytesRead) break
          hash.update(bytes.subarray(0, bytesRead))
          size += bytesRead
        }
        if (stampOf(await this.stat(path)).generation !== before.generation)
          throw new EngineError('conflict', `${path} changed while reading`)
        return {
          ...before,
          size,
          sha: Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join(''),
        }
      } finally {
        await handle.close()
      }
    }
    const source = await this.openRead(path)
    const identity = await fingerprintSource(source, MAX_CHUNK_BYTES, signal)
    return { ...source.stamp, ...identity }
  }
  async create(path: string, mtime: number): Promise<void> {
    this.assertOwned()
    if (this.raw.fsPromises?.open && this.raw.getFullPath) {
      const handle = await this.effect(() =>
        this.raw.fsPromises.open(this.raw.getFullPath(path), 'wx')
      )
      try {
        await this.effect(() => handle.sync())
      } finally {
        await handle.close()
      }
      await this.date(path, mtime)
    } else await this.adapter.writeBinary(path, new ArrayBuffer(0), { mtime })
  }
  async append(
    path: string,
    offset: number,
    bytes: Uint8Array,
    mtime: number,
    signal?: AbortSignal
  ): Promise<void> {
    signal?.throwIfAborted()
    this.assertOwned()
    await this.requireTransfer(offset + bytes.length)
    if (bytes.buffer.byteLength > MAX_CHUNK_BYTES || bytes.length > MAX_CHUNK_BYTES)
      throw new EngineError('io', 'oversized staging chunk')
    if ((await this.stat(path)).size !== offset)
      throw new EngineError('io', 'staging offset changed')
    if (this.raw.fsPromises?.open && this.raw.getFullPath) {
      const handle = await this.raw.fsPromises.open(this.raw.getFullPath(path), 'r+')
      try {
        let written = 0
        while (written < bytes.length) {
          signal?.throwIfAborted()
          this.assertOwned()
          const result = await this.effect(() =>
            handle.write(bytes, written, bytes.length - written, offset + written)
          )
          if (!result.bytesWritten) throw new EngineError('io', 'short staging write')
          written += result.bytesWritten
        }
        await this.effect(() => handle.sync())
      } finally {
        await handle.close()
      }
      await this.date(path, mtime)
    } else {
      if (typeof this.adapter.appendBinary === 'function')
        await this.adapter.appendBinary(path, bytesOf(bytes), { mtime })
      else {
        if (offset + bytes.length > PHONE_FALLBACK_BYTES)
          throw new EngineError(
            'io',
            'Bounded staging writes are unavailable; the fallback limit is 50 MiB'
          )
        const existing = new Uint8Array(await this.adapter.readBinary(path))
        const complete = new Uint8Array(offset + bytes.length)
        complete.set(existing)
        complete.set(bytes, offset)
        this.assertOwned()
        await this.adapter.writeBinary(path, complete.buffer, { mtime })
      }
    }
    signal?.throwIfAborted()
    this.assertOwned()
  }
  private async date(path: string, mtime: number): Promise<void> {
    this.assertOwned()
    if (this.raw.fsPromises?.utimes && this.raw.getFullPath)
      await this.effect(() =>
        this.raw.fsPromises.utimes(this.raw.getFullPath(path), mtime / 1000, mtime / 1000)
      )
  }
}
