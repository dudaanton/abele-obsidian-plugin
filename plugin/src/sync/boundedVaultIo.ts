import { mobileLargeFileGate } from './mobileLargeFileGate'
import { mobileBridgeRead } from './mobileBridgeRead'
import { NativeReadTimeout } from './nativeReadDeadline'
import { nativeChunkPort } from './vaultPathLinks'
import { guardedVaultAdapter, ensureVaultDirectory } from './vaultPathLinks'
import type { DataAdapter, Stat } from 'obsidian'
import {
  EngineError,
  MAX_CHUNK_BYTES,
  fingerprintSource,
  type ChunkSource,
  type SourceStamp,
  type ContentIdentity,
} from '@abele/sync-sdk/core'
import { bytesOf } from './vaultWrites'
import { sha256 } from '@noble/hashes/sha2'
import { probeSequentialFiles, type ProbeEvent } from './mobileSequentialSource'
import { probeResourceRanges } from './mobileResourceRanges'
import { probeResourceStream } from './mobileResourceStream'
import { mobileReadMeter } from './mobileReadDiagnostics'
import {
  MOBILE_WHOLE_READ_MAX,
  MobileWholeReadLimitError,
  PHONE_FALLBACK_BYTES,
} from './mobileWholeRead'
import { stagingDirectory, reserveStagingPath } from './stagingDirectory'
import { makeParents } from './vaultFolders'
import { SyncTaskBudget, waitForSyncRead } from './syncTaskBudget'

interface MobileFiles {
  readFile(options: { path: string; offset: number; length: number }): Promise<{ data: string }>
  stat(options: { path: string }): Promise<{ size: number }>
  readFileInChunks?(
    options: { path: string; offset: number; length: number; chunkSize: number },
    callback: (chunk: { data: string | null } | null, error?: { message: string } | string) => void
  ): Promise<string>
}
interface MobileAccess {
  files?: MobileFiles
}
interface MobileProbeResult {
  access: MobileAccess | null
  stream: Awaited<ReturnType<typeof probeResourceStream>>
  resource: Awaited<ReturnType<typeof probeResourceRanges>>
  sequential: Awaited<ReturnType<typeof probeSequentialFiles>>
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
function readMobileChunk(
  files: MobileFiles,
  path: string,
  offset: number,
  length: number,
  signal?: AbortSignal,
  trace: (event: ProbeEvent) => void = () => {}
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  const options = { path, offset, length }
  trace({ step: 'call', method: 'readFile', options })
  return mobileBridgeRead('readFile', path, () => files.readFile(options), signal).then(
    (result) => {
      trace({ step: 'result', method: 'readFile', result })
      signal?.throwIfAborted()
      return decode(result.data, length)
    }
  )
}

interface WriteReceipt {
  hash: ReturnType<typeof sha256.create>
  stamp: SourceStamp
}
// Process-local acknowledgements only; changed content stamps require ordinary reads.
const writeReceipts = new WeakMap<object, Map<string, WriteReceipt>>()

/** Native capabilities are discovered on the adapter, without loading Node on mobile. */
export class BoundedVaultIo {
  private readonly taskBudget = new SyncTaskBudget()
  private rangedMobile: Promise<MobileProbeResult> | undefined
  private sequentialMobile: Awaited<ReturnType<typeof probeSequentialFiles>> = null
  private streamMobile: Awaited<ReturnType<typeof probeResourceStream>> = null
  private resourceMobile: Awaited<ReturnType<typeof probeResourceRanges>> = null
  private capabilitySource?: BoundedVaultIo
  private capabilitySignature?: unknown[]
  reuseCapabilitiesFrom(source: BoundedVaultIo): void {
    this.capabilitySource = source
  }
  invalidateCapabilities(): void {
    this.capabilitySource?.invalidateCapabilities()
    this.rangedMobile = undefined
    this.sequentialMobile = null
    this.resourceMobile = null
    this.streamMobile = null
    this.capabilitySignature = undefined
  }
  private capabilityInputs(): unknown[] {
    const files = mobileFiles()
    // Native plugin proxies manufacture a fresh callable on every property read.
    // Own method/getter descriptors detect real replacements without making those
    // wrappers invalidate an overlapping probe forever. Proxy-only methods keep
    // their capability kind until the bridge/mapping changes or a fresh poll.
    const method = (key: string) => {
      if (!files) return undefined
      const descriptor = Object.getOwnPropertyDescriptor(files, key)
      return (
        descriptor?.value ??
        (descriptor && Reflect.get(descriptor, 'get')) ??
        typeof Reflect.get(files, key)
      )
    }
    let mapping: string
    try {
      mapping = this.mobilePath(
        stagingDirectory(this.configDir, this.privateRoot) + '/capability-check.tmp'
      )
    } catch {
      mapping = 'unavailable'
    }
    return [
      typeof window === 'undefined' ? undefined : Reflect.get(window, 'fetch'),
      files,
      method('stat'),
      method('readFile'),
      method('readFileInChunks'),
      method('copy'),
      method('getUri'),
      method('deleteFile'),
      method('mkdir'),
      method('readdir'),
      mapping,
    ]
  }
  constructor(
    readonly disk: DataAdapter,
    private readonly assertOwned: () => void = () => {},
    private readonly effect: <T>(work: () => T) => T = (work) => work(),
    private readonly receiptScope: object = disk,
    private readonly configDir?: string,
    private readonly privateRoot?: string,
    private readonly metadataReceipts = false
  ) {
    this.disk = guardedVaultAdapter(disk)
  }
  private get receipts(): Map<string, WriteReceipt> {
    let receipts = writeReceipts.get(this.receiptScope)
    if (!receipts) writeReceipts.set(this.receiptScope, (receipts = new Map()))
    return receipts
  }
  retireReceipts(): void {
    this.receipts.clear()
  }
  /** Call only after an acknowledged owned write, with the hash of its written chunks. */
  async recordWrite(
    path: string,
    size: number,
    hash: ReturnType<typeof sha256.create>
  ): Promise<void> {
    this.assertOwned()
    const stat = await this.disk.stat(path)
    this.assertOwned()
    if (!stat) return
    if (stat.type !== 'file' || stat.size !== size)
      throw new EngineError('conflict', 'Written file changed')
    this.receipts.set(path, { hash: hash.clone(), stamp: stampOf(stat) })
  }
  async requireWrite(size: number): Promise<void> {
    if (
      size <= PHONE_FALLBACK_BYTES ||
      typeof this.disk.appendBinary === 'function' ||
      (this.raw.open && this.raw.fullPath)
    )
      return
    throw new EngineError(
      'io',
      'Bounded staging writes are unavailable; the fallback limit is 50 MiB'
    )
  }
  async adoptReceipt(from: string, to: string): Promise<void> {
    const receipt = this.receipts.get(from)
    if (!receipt) return
    const stamp = stampOf(await this.stat(to))
    if (stamp.size !== receipt.stamp.size || stamp.mtime !== receipt.stamp.mtime) {
      this.receipts.delete(from)
      throw new EngineError('conflict', 'Published file changed')
    }
    this.receipts.set(to, { hash: receipt.hash.clone(), stamp })
    this.receipts.delete(from)
  }
  private get raw() {
    return nativeChunkPort(this.disk)
  }
  async requireTransfer(size: number): Promise<void> {
    if (size <= PHONE_FALLBACK_BYTES || (this.raw.open && this.raw.fullPath)) return
    if (!(await this.mobile()) && size > MOBILE_WHOLE_READ_MAX)
      throw new MobileWholeReadLimitError(size)
    if (typeof this.disk.appendBinary !== 'function')
      throw new EngineError(
        'io',
        'Bounded staging writes are unavailable; the fallback limit is 50 MiB'
      )
  }
  async canReplayStage(): Promise<boolean> {
    return !!(this.raw.open && this.raw.fullPath) || !!(await this.mobile())
  }
  async canResumeStage(path: string): Promise<boolean> {
    const receipt = this.receipts.get(path)
    if (receipt && stampOf(await this.stat(path)).generation === receipt.stamp.generation)
      return true
    return this.canReplayStage()
  }
  private async stat(path: string): Promise<Stat> {
    this.assertOwned()
    const stat = await this.disk.stat(path)
    this.assertOwned()
    if (!stat || stat.type !== 'file') throw new EngineError('io', `cannot read ${path}`)
    return stat
  }
  private mobilePath(path: string): string {
    if (this.raw.fullPath) return this.raw.fullPath(path)
    const resource = new URL(this.disk.getResourcePath(path))
    if (resource.protocol === 'file:') return new URL(resource.pathname, 'file://').href
    const prefix = '/_capacitor_file_/'
    if (
      resource.hostname === 'localhost' &&
      ['capacitor:', 'http:', 'https:'].includes(resource.protocol) &&
      resource.pathname.startsWith(prefix)
    )
      return new URL(resource.pathname.slice(prefix.length - 1), 'file://').href
    throw new EngineError('io', 'Native vault path mapping is unavailable')
  }
  /** No Directory is supplied: use the adapter's native path or Capacitor file resource URL.
   * Probe both mapping and offset/length against a tiny file, never against a large input. */
  private async mobile(): Promise<MobileAccess | null> {
    this.assertOwned()
    if (this.capabilitySource) {
      const access = await this.capabilitySource.mobile()
      this.assertOwned()
      this.resourceMobile = this.capabilitySource.resourceMobile
      this.streamMobile = this.capabilitySource.streamMobile
      this.sequentialMobile = this.capabilitySource.sequentialMobile
      return access
    }
    const inputs = this.capabilityInputs()
    if (
      !this.capabilitySignature ||
      inputs.some((input, at) => input !== this.capabilitySignature?.[at])
    ) {
      this.invalidateCapabilities()
      this.capabilitySignature = inputs
    }
    const pending = (this.rangedMobile ??= this.runMobileProbe())
    const result = await pending.catch((error) => {
      // A lost bridge answer is transient, not proof that ranges are unsupported.
      if (this.rangedMobile === pending) this.rangedMobile = undefined
      throw error
    })
    if (this.rangedMobile !== pending) return this.mobile()
    this.resourceMobile = result.resource
    this.streamMobile = result.stream
    this.sequentialMobile = result.sequential
    return result.access
  }
  async diagnoseMobile(): Promise<{ available: boolean; mode: string; events: ProbeEvent[] }> {
    if (this.capabilitySource) return this.capabilitySource.diagnoseMobile()
    this.capabilitySignature = this.capabilityInputs()
    const events: ProbeEvent[] = []
    this.rangedMobile = this.runMobileProbe((event) => events.push(event))
    const available = await this.mobile()
    return {
      available: available !== null,
      mode: this.resourceMobile
        ? 'webview-ranges'
        : this.streamMobile
          ? 'cached-native-ranges'
          : this.sequentialMobile
            ? 'sequential'
            : available
              ? 'ranged'
              : 'unavailable',
      events,
    }
  }
  private async runMobileProbe(
    trace: (event: ProbeEvent) => void = () => {}
  ): Promise<MobileProbeResult> {
    const state: MobileProbeResult = {
      access: null,
      resource: null,
      stream: null,
      sequential: null,
    }
    state.access = await this.probeMobile(trace, state)
    return state
  }
  private async probeMobile(
    trace: (event: ProbeEvent) => void,
    state: MobileProbeResult
  ): Promise<MobileAccess | null> {
    state.sequential = null
    state.resource =
      typeof window === 'undefined' || typeof window.fetch !== 'function'
        ? null
        : await probeResourceRanges(
            this.disk,
            window.fetch.bind(window),
            trace,
            this.configDir,
            this.privateRoot
          )
    if (state.resource) {
      console.debug('[abele-sync] WebView file ranges verified')
      return {}
    }
    state.stream =
      typeof window === 'undefined' || typeof window.fetch !== 'function'
        ? null
        : await probeResourceStream(
            this.disk,
            window.fetch.bind(window),
            trace,
            this.configDir,
            this.privateRoot
          )
    if (state.stream) {
      console.debug('[abele-sync] cached native file ranges verified')
      return {}
    }
    const files = mobileFiles()
    trace({
      step: 'capabilities',
      stat: typeof files?.stat,
      readFile: typeof files?.readFile,
      readFileInChunks: typeof files?.readFileInChunks,
    })
    if ((!files?.readFile && !files?.readFileInChunks) || !files?.stat) return null
    state.sequential = await probeSequentialFiles(
      this.disk,
      files,
      trace,
      this.configDir,
      this.privateRoot
    )
    if (state.sequential) {
      console.debug('[abele-sync] native filesystem sequential chunks verified')
      return { files }
    }
    if (!files.readFile) return null
    const path = `${stagingDirectory(this.configDir, this.privateRoot)}/.abele-sync-${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}.tmp`
    let created = false
    const release = reserveStagingPath(path)
    try {
      if (await this.disk.exists(path)) return null
      await makeParents(this.disk, path)
      this.assertOwned()
      trace({ step: 'create', path, bytes: 4 })
      await this.disk.writeBinary(path, new Uint8Array([11, 37, 89, 143]).buffer)
      created = true
      const absolute = this.mobilePath(path)
      trace({ step: 'call', method: 'stat', options: { path: absolute } })
      const stat = await mobileBridgeRead('stat', absolute, () => files.stat({ path: absolute }))
      trace({ step: 'result', method: 'stat', result: stat })
      const bytes = await readMobileChunk(files, absolute, 1, 2, undefined, trace)
      trace({ step: 'result', method: 'ranged-read', bytes: Array.from(bytes) })
      if (stat.size !== 4 || bytes.length !== 2 || bytes[0] !== 37 || bytes[1] !== 89) return null
      console.debug('[abele-sync] native filesystem bounded ranges verified')
      return { files }
    } catch (error) {
      trace({ step: 'error', message: error instanceof Error ? error.message : String(error) })
      console.debug('[abele-sync] native filesystem ranges unavailable', error)
      if (error instanceof NativeReadTimeout) throw error
      return null
    } finally {
      try {
        if (created) {
          this.assertOwned()
          await this.disk.remove(path)
          trace({ step: 'delete', path })
        }
      } finally {
        release()
      }
    }
  }
  openUploadRead(path: string, expected?: SourceStamp, signal?: AbortSignal): Promise<ChunkSource> {
    return this.openSource(path, expected, true, signal)
  }
  openRead(path: string, expected?: SourceStamp): Promise<ChunkSource> {
    return this.openSource(path, expected, false)
  }
  /** Legacy consumers still need complete bytes, but native results stay chunked. */
  async readAll(path: string): Promise<Uint8Array> {
    const source = await this.openSource(path, undefined, true, undefined, true)
    try {
      const bytes = new Uint8Array(source.size)
      for (let at = 0; at < bytes.length; at += MAX_CHUNK_BYTES) {
        bytes.set(await source.read(at, Math.min(MAX_CHUNK_BYTES, bytes.length - at)), at)
      }
      await source.assertUnchanged()
      return bytes
    } finally {
      await source.close()
    }
  }
  private async openSource(
    path: string,
    expected: SourceStamp | undefined,
    wholeFileUpload: boolean,
    signal?: AbortSignal,
    requireChunks = false
  ): Promise<ChunkSource> {
    const original = stampOf(await this.stat(path))
    if (expected && original.generation !== expected.generation)
      throw new EngineError('conflict', `${path} changed before opening`)
    const raw = this.raw
    const handle = raw.open && raw.fullPath ? await raw.open(raw.fullPath(path), 'r') : null
    // Keep inline allocations small; the larger legacy ceiling is not an inline-read budget.
    const small = original.size <= 4 * 1024 * 1024
    const access = handle || small ? null : await waitForSyncRead(this.mobile(), signal)
    const files = access?.files
    const resource = access && this.resourceMobile
    const sequential =
      access && this.streamMobile
        ? this.streamMobile.open(path, original.size)
        : !resource && files
          ? this.sequentialMobile?.open(path, original.size)
          : undefined
    let fallback: Uint8Array | null = null
    const meter = mobileReadMeter()
    if (!handle && !access) {
      if (requireChunks && !small)
        throw new EngineError(
          'io',
          'Bounded file reads are unavailable; local bytes retained for retry'
        )
      if (!wholeFileUpload && original.size > PHONE_FALLBACK_BYTES)
        throw new EngineError(
          'io',
          'Bounded file reads are unavailable; the fallback limit is 50 MiB'
        )
      if (original.size > MOBILE_WHOLE_READ_MAX) throw new MobileWholeReadLimitError(original.size)
    }
    let releaseLarge: (() => void) | undefined
    let closed = false
    let loading: Promise<void> | undefined
    const cancellation = !handle && !access && !small ? new AbortController() : undefined
    const abort = () => cancellation?.abort(signal?.reason)
    if (signal?.aborted) abort()
    else if (cancellation) signal?.addEventListener('abort', abort, { once: true })
    const loadFallback = async () => {
      if (closed) throw new EngineError('io', 'bounded file source is closed')
      const currentSignal = cancellation?.signal ?? signal
      currentSignal?.throwIfAborted()
      if (!small) releaseLarge = await mobileLargeFileGate.acquire(currentSignal, 'local upload')
      try {
        this.assertOwned()
        currentSignal?.throwIfAborted()
        if (!small) meter.wholeRead()
        fallback = new Uint8Array(await this.disk.readBinary(path))
        this.assertOwned()
        currentSignal?.throwIfAborted()
        if (fallback.length !== original.size)
          throw new EngineError('conflict', `${path} changed while reading`)
        if (!small) {
          console.debug('[abele-sync] mobile whole-file read', { bytes: fallback.byteLength })
          meter.opened()
          meter.chunk(fallback.length, fallback.byteLength, MOBILE_WHOLE_READ_MAX)
          meter.hold(fallback.byteLength)
        }
      } catch (error) {
        fallback = null
        meter.hold(0)
        meter.closed()
        releaseLarge?.()
        releaseLarge = undefined
        throw error
      }
    }
    if (!handle && !access) {
      // Legacy hosts without a streaming port retain their bounded-size upload fallback.
      // Slice only the outgoing part: the bridge must never receive the whole backing buffer.
      // Opening a queued source precedes its transfer-budget slot. Taking the
      // buffer lease here can deadlock a scanner that already owns that slot.
      // Large reads acquire only inside read(), like remote hydration sources.
      if (small) loading = loadFallback()
      if (loading !== undefined) await loading
    }
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
        } else if (resource) {
          bytes = await resource.read(path, original.size, offset, length, signal)
        } else if (sequential) {
          bytes = await sequential.read(offset, length, signal)
        } else if (files) {
          bytes = await readMobileChunk(files, this.mobilePath(path), offset, length, signal)
        } else {
          const abortRead = () => cancellation?.abort(signal?.reason)
          signal?.addEventListener('abort', abortRead, { once: true })
          try {
            await (loading ??= loadFallback())
          } finally {
            signal?.removeEventListener('abort', abortRead)
          }
          if (closed || !fallback) throw new EngineError('io', 'bounded file source is closed')
          bytes = fallback.slice(offset, offset + length)
          if (!small) {
            meter.output(bytes.length)
            meter.hold(fallback.byteLength + bytes.byteLength)
            meter.hold(fallback.byteLength)
          }
        }
        signal?.throwIfAborted()
        this.assertOwned()
        if (bytes.length !== length) throw new EngineError('io', 'truncated bounded file read')
        await this.taskBudget.account(bytes.length, signal)
        this.assertOwned()
        return bytes
      },
      assertUnchanged: unchanged,
      close: async () => {
        if (closed) return
        closed = true
        cancellation?.abort(new Error('Bounded source closed'))
        await loading?.catch(() => {})
        fallback = null
        meter.hold(0)
        meter.closed()
        await sequential?.close()
        try {
          await handle?.close()
        } finally {
          signal?.removeEventListener('abort', abort)
          releaseLarge?.()
        }
      },
    }
  }
  /** Hash and publish while the one mobile buffer is alive, rather than reread after scanning.
   * The caller only publishes content-addressed bytes; ordinary engine commits still own paths.
   * No buffer survives a completed scan callback, an upload failure, or a server hit. */
  async fingerprintForUpload(
    path: string,
    consume: (identity: ContentIdentity, source: ChunkSource) => Promise<void>,
    signal?: AbortSignal,
    acknowledged?: (identity: ContentIdentity) => boolean
  ) {
    const stat = await this.stat(path)
    if (
      stat.size <= PHONE_FALLBACK_BYTES ||
      (this.raw.open && this.raw.fullPath) ||
      (await this.mobile())
    )
      return undefined
    signal?.throwIfAborted()
    const receipt = this.receipts.get(path)
    if (receipt && receipt.stamp.size === stat.size && receipt.stamp.mtime === stat.mtime) {
      const identity = {
        size: stat.size,
        sha: Array.from(receipt.hash.clone().digest(), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join(''),
      }
      if (acknowledged?.(identity)) return { ...stampOf(stat), ...identity }
    }
    const source = await this.openUploadRead(path, undefined, signal)
    const hash = sha256.create()
    try {
      const identity = await fingerprintSource(
        {
          ...source,
          read: async (offset, length, readSignal) => {
            const bytes = await source.read(offset, length, readSignal)
            hash.update(bytes)
            return bytes
          },
          close: async () => {},
        },
        MAX_CHUNK_BYTES,
        signal
      )
      await consume(identity, { ...source, close: async () => {} })
      await source.assertUnchanged()
      this.receipts.set(path, { hash, stamp: source.stamp })
      return { ...source.stamp, ...identity }
    } finally {
      await source.close()
    }
  }
  async fingerprint(path: string, signal?: AbortSignal, boundedOnly = false, fresh = false) {
    if (this.raw.open && this.raw.fullPath) {
      const before = stampOf(await this.stat(path))
      const handle = await this.raw.open(this.raw.fullPath(path), 'r')
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
          await this.taskBudget.account(bytesRead, signal)
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
    signal?.throwIfAborted()
    const receipt = fresh ? undefined : this.receipts.get(path)
    if (receipt) {
      const stamp = stampOf(await this.stat(path))
      if (
        this.metadataReceipts
          ? stamp.size === receipt.stamp.size && stamp.mtime === receipt.stamp.mtime
          : stamp.generation === receipt.stamp.generation
      )
        return {
          ...stamp,
          sha: Array.from(receipt.hash.clone().digest(), (byte) =>
            byte.toString(16).padStart(2, '0')
          ).join(''),
        }
      // A recorded large mobile file with changed metadata must stay local. Never
      // turn an invalidated receipt into an automatic whole-file eviction proof.
      if (this.metadataReceipts && stamp.size > PHONE_FALLBACK_BYTES)
        throw new EngineError('conflict', 'Recorded file changed; file kept')
      if (stamp.size !== receipt.stamp.size || stamp.mtime !== receipt.stamp.mtime)
        this.receipts.delete(path)
    }
    if (
      boundedOnly &&
      (await this.stat(path)).size > MAX_CHUNK_BYTES &&
      !(await this.canReplayStage())
    )
      throw new EngineError(
        'conflict',
        'Existing bytes require bounded local verification; file kept'
      )
    const source = await this.openRead(path)
    if (!this.metadataReceipts) {
      const identity = await fingerprintSource(source, MAX_CHUNK_BYTES, signal)
      return { ...source.stamp, ...identity }
    }
    const hash = sha256.create()
    const identity = await fingerprintSource(
      {
        ...source,
        read: async (offset, length, signal) => {
          const bytes = await source.read(offset, length, signal)
          hash.update(bytes)
          return bytes
        },
      },
      MAX_CHUNK_BYTES,
      signal
    )
    this.assertOwned()
    this.receipts.set(path, { hash, stamp: source.stamp })
    return { ...source.stamp, ...identity }
  }
  async create(
    path: string,
    mtime: number,
    durability: 'acknowledged' | 'deferred' = 'acknowledged'
  ): Promise<void> {
    this.assertOwned()
    const cut = path.lastIndexOf('/')
    if (cut > 0) await this.effect(() => ensureVaultDirectory(this.disk, path.slice(0, cut)))
    if (this.raw.open && this.raw.fullPath) {
      const handle = await this.effect(() => this.raw.open(this.raw.fullPath(path), 'wx'))
      try {
        await this.date(path, mtime)
        if (durability === 'acknowledged') await this.effect(() => handle.sync())
      } finally {
        await handle.close()
      }
    } else {
      this.receipts.delete(path)
      await this.disk.writeBinary(path, new ArrayBuffer(0), { mtime })
      this.receipts.set(path, { hash: sha256.create(), stamp: stampOf(await this.stat(path)) })
    }
  }
  async append(
    path: string,
    offset: number,
    bytes: Uint8Array,
    mtime: number,
    signal?: AbortSignal,
    durability: 'acknowledged' | 'deferred' = 'acknowledged'
  ): Promise<void> {
    signal?.throwIfAborted()
    this.assertOwned()
    await this.requireWrite(offset + bytes.length)
    if (bytes.buffer.byteLength > MAX_CHUNK_BYTES || bytes.length > MAX_CHUNK_BYTES)
      throw new EngineError('io', 'oversized staging chunk')
    if ((await this.stat(path)).size !== offset)
      throw new EngineError('io', 'staging offset changed')
    if (this.raw.open && this.raw.fullPath) {
      const handle = await this.raw.open(this.raw.fullPath(path), 'r+')
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
        await this.date(path, mtime)
        if (durability === 'acknowledged') await this.effect(() => handle.sync())
      } finally {
        await handle.close()
      }
    } else {
      const before = stampOf(await this.stat(path))
      let receipt = this.receipts.get(path)
      if (!receipt || receipt.stamp.generation !== before.generation) {
        this.receipts.delete(path)
        if (before.size > PHONE_FALLBACK_BYTES && !(await this.canReplayStage()))
          throw new EngineError(
            'io',
            'Bounded staging recovery is unavailable; the fallback limit is 50 MiB'
          )
        const hash = sha256.create()
        const source = await this.openRead(path)
        try {
          for (let at = 0; at < source.size; at += MAX_CHUNK_BYTES)
            hash.update(await source.read(at, Math.min(MAX_CHUNK_BYTES, source.size - at), signal))
          await source.assertUnchanged()
        } finally {
          await source.close()
        }
        receipt = { hash, stamp: before }
      }
      // An uncertain append cannot contribute an acknowledged identity.
      this.receipts.delete(path)
      if (typeof this.disk.appendBinary === 'function')
        await this.disk.appendBinary(path, bytesOf(bytes), { mtime })
      else {
        if (offset + bytes.length > PHONE_FALLBACK_BYTES)
          throw new EngineError(
            'io',
            'Bounded staging writes are unavailable; the fallback limit is 50 MiB'
          )
        const existing = new Uint8Array(await this.disk.readBinary(path))
        const complete = new Uint8Array(offset + bytes.length)
        complete.set(existing)
        complete.set(bytes, offset)
        this.assertOwned()
        await this.disk.writeBinary(path, complete.buffer, { mtime })
      }
      const stamp = stampOf(await this.stat(path))
      if (stamp.size !== offset + bytes.length)
        throw new EngineError('io', 'Staging append size is invalid')
      receipt.hash.update(bytes)
      this.receipts.set(path, { hash: receipt.hash, stamp })
    }
    signal?.throwIfAborted()
    this.assertOwned()
  }
  private async date(path: string, mtime: number): Promise<void> {
    this.assertOwned()
    if (this.raw.utimes && this.raw.fullPath)
      await this.effect(() => this.raw.utimes(this.raw.fullPath(path), mtime / 1000, mtime / 1000))
  }
}
