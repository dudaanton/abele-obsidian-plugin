import { mobileLargeFileGate } from './mobileLargeFileGate'
import { mobileBridgeRead } from './mobileBridgeRead'
import { NativeReadTimeout } from './nativeReadDeadline'
import { nativeChunkPort } from './vaultPathLinks'
import { guardedVaultAdapter, ensureVaultDirectory } from './vaultPathLinks'
import type { DataAdapter, Stat } from 'obsidian'
import {
  EngineError,
  MAX_CHUNK_BYTES,
  EAGER_READ_CAP,
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
import { adapterInstallationEpoch } from './installationEpoch'

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

interface ByteWitness {
  size: number
  digest: Uint8Array
}
interface WriteReceipt {
  hash: ReturnType<typeof sha256.create>
  stamp: SourceStamp
  witnesses?: readonly ByteWitness[]
  binding?: { revision: () => number; epoch: number }
  installation?: { revision: () => number; epoch: number }
}
// Process-local acknowledgements only; changed content stamps require ordinary reads.
const writeReceipts = new WeakMap<object, Map<string, WriteReceipt>>()
const installedReceipts = new WeakMap<object, Map<string, WriteReceipt>>()

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
    private readonly metadataReceipts = false,
    private readonly installationEpochFor = adapterInstallationEpoch(receiptScope as DataAdapter),
    private readonly installationScope: object = receiptScope
  ) {
    this.disk = guardedVaultAdapter(disk)
  }
  private get receipts(): Map<string, WriteReceipt> {
    let receipts = writeReceipts.get(this.receiptScope)
    if (!receipts) writeReceipts.set(this.receiptScope, (receipts = new Map()))
    return receipts
  }
  private get installations(): Map<string, WriteReceipt> {
    let receipts = installedReceipts.get(this.installationScope)
    if (!receipts) installedReceipts.set(this.installationScope, (receipts = new Map()))
    return receipts
  }
  retireReceipts(): void {
    this.receipts.clear()
    this.installations.clear()
  }
  invalidateInstallations(path = ''): void {
    for (const [key, receipt] of this.receipts)
      if (!path || key === path || key.startsWith(path + '/')) {
        receipt.installation = undefined
        receipt.binding = undefined
      }
    for (const [key, receipt] of this.installations)
      if (!path || key === path || key.startsWith(path + '/')) {
        receipt.installation = undefined
        receipt.binding = undefined
      }
  }
  private installationReceipt(
    hash: WriteReceipt['hash'],
    stamp: SourceStamp,
    proof: NonNullable<WriteReceipt['installation']>,
    installed = true,
    witnesses?: readonly ByteWitness[]
  ): WriteReceipt {
    return {
      hash,
      stamp,
      witnesses,
      ...(proof.revision() === proof.epoch
        ? { binding: proof, ...(installed ? { installation: proof } : {}) }
        : {}),
    }
  }
  private installationEpoch(path: string): NonNullable<WriteReceipt['installation']> {
    const clock = this.installationEpochFor
    const revision = () => clock(path)
    return { revision, epoch: revision() }
  }
  /** Only hashes of our own observed bytes with a live host binding may be reused. */
  private receiptStillBinds(
    receipt: WriteReceipt | undefined,
    path: string,
    stat: Stat | SourceStamp
  ): receipt is WriteReceipt {
    const proof = receipt?.binding
    return !!(
      receipt &&
      proof &&
      proof.revision() === proof.epoch &&
      this.installationEpochFor(path) === proof.epoch &&
      stat.size === receipt.stamp.size &&
      stat.mtime === receipt.stamp.mtime &&
      (this.metadataReceipts ||
        ('generation' in stat ? stat.generation : stampOf(stat).generation) ===
          receipt.stamp.generation)
    )
  }
  private async witness(bytes: Uint8Array, native = false): Promise<ByteWitness[]> {
    const result: ByteWitness[] = []
    for (let at = 0; at < bytes.length; at += MAX_CHUNK_BYTES) {
      const chunk = bytes.subarray(at, at + MAX_CHUNK_BYTES)
      const hostCrypto = typeof window === 'undefined' ? undefined : window.crypto
      const digest =
        native && hostCrypto?.subtle
          ? new Uint8Array(
              await hostCrypto.subtle.digest('SHA-256', chunk as Uint8Array<ArrayBuffer>)
            )
          : sha256(chunk)
      result.push({ size: chunk.length, digest })
      const pause = this.taskBudget.account(chunk.length)
      if (pause !== undefined) await pause
    }
    return result
  }
  /** Observe the complete owned host mutation before assigning a replacement epoch. */
  private observeReceiptMutation(
    paths: readonly string[],
    directory: boolean,
    kind: string | readonly string[] = directory ? 'rename' : 'writeBinary',
    expectedBytes?: { hash: WriteReceipt['hash']; witnesses: readonly ByteWitness[] }
  ) {
    const key = this.installationEpochFor.key ?? ((path: string) => path)
    const expected = paths.map(key)
    const history: string[] = []
    let uncertain = false
    let proof: WriteReceipt['binding']
    let written: { hash: WriteReceipt['hash']; size: number; ready: boolean } | undefined
    const owned = () => {
      const steps = typeof kind === 'string' ? [kind] : kind
      let at = 0
      for (const step of steps) {
        if (history[at++] !== step + ':before') return false
        if (step === 'appendBinary' && history[at] === 'writeBinary:before') {
          if (history[at + 1] !== 'writeBinary:after') return false
          at += 2
        }
        if (history[at++] !== step + ':after') return false
      }
      return at === history.length
    }
    const stop = this.installationEpochFor.observe?.((changed, changedDirectory, mutation) => {
      if (
        !changed.some(
          (path) => !path || expected.some((name) => name === path || name.startsWith(path + '/'))
        )
      )
        return
      if (
        changedDirectory !== directory ||
        changed.length !== expected.length ||
        changed.some((path, index) => path !== expected[index]) ||
        !mutation ||
        mutation.authoritative === false
      )
        uncertain = true
      if (history.length < (typeof kind === 'string' ? 8 : kind.length * 4) + 1)
        history.push((mutation?.kind ?? 'event') + ':' + (mutation?.phase ?? 'event'))
      proof = this.installationEpoch(paths[paths.length - 1])
      if (directory || mutation?.phase !== 'after' || mutation.kind !== 'writeBinary') return
      if (!mutation.bytes || mutation.bytes.byteLength > MOBILE_WHOLE_READ_MAX) {
        uncertain = true
        return
      }
      const value = { hash: sha256.create(), size: mutation.bytes.byteLength, ready: false }
      written = value
      const bytes = new Uint8Array(mutation.bytes)
      // The adapter keeps its write promise pending until this observer finishes, so
      // the caller still owns an immutable write buffer. No disk read or copy occurs.
      return (async () => {
        if (
          expectedBytes &&
          expectedBytes.witnesses.reduce((size, block) => size + block.size, 0) === bytes.length
        ) {
          let at = 0,
            matches = true
          const hostCrypto = typeof window === 'undefined' ? undefined : window.crypto
          const width = bytes.length > MAX_CHUNK_BYTES && hostCrypto?.subtle ? 4 : 1
          for (let index = 0; index < expectedBytes.witnesses.length; index += width) {
            const batch = expectedBytes.witnesses.slice(index, index + width)
            // At most four bounded native snapshots are live, never a whole-file copy.
            const actual = await Promise.all(
              batch.map((block) => {
                const from = at
                at += block.size
                return this.witness(bytes.subarray(from, at), bytes.length > MAX_CHUNK_BYTES)
              })
            )
            if (
              batch.some(
                (block, item) =>
                  !actual[item]?.[0]?.digest.every((byte, offset) => byte === block.digest[offset])
              )
            ) {
              matches = false
              break
            }
          }
          if (matches) {
            value.hash = expectedBytes.hash.clone()
            value.ready = true
            return
          }
        }
        for (let at = 0; at < bytes.length; at += MAX_CHUNK_BYTES) {
          const chunk = bytes.subarray(at, at + MAX_CHUNK_BYTES)
          value.hash.update(chunk)
          const pause = this.taskBudget.account(chunk.length)
          if (pause !== undefined) await pause
        }
        value.ready = true
      })()
    })
    return {
      proof: () => (!uncertain && owned() ? proof : undefined),
      owned,
      compound: () =>
        history.some(
          (step, index) =>
            step === 'appendBinary:before' && history[index + 1] === 'writeBinary:before'
        ),
      written: () => (written?.ready ? written : undefined),
      stop: () => stop?.(),
    }
  }
  async verifiedInstallation(
    path: string,
    expected: { sha: string; size: number }
  ): Promise<boolean> {
    const shared = this.installations.get(path)
    const receipt = shared ?? this.receipts.get(path)
    const proof = receipt?.installation
    if (
      !receipt ||
      !proof ||
      !this.receiptStillBinds(receipt, path, receipt.stamp) ||
      receipt.stamp.size !== expected.size
    )
      return false
    const sha = Array.from(receipt.hash.clone().digest(), (b) =>
      b.toString(16).padStart(2, '0')
    ).join('')
    if (sha !== expected.sha) return false
    const current = await this.stat(path)
    return (
      this.receiptStillBinds(receipt, path, current) &&
      (shared ? this.installations.get(path) : this.receipts.get(path)) === receipt &&
      receipt.installation === proof
    )
  }
  /** Call only after an acknowledged owned write, with the hash of its written chunks. */
  async recordWrite(
    path: string,
    size: number,
    hash: ReturnType<typeof sha256.create>,
    existingOnly = false
  ): Promise<void> {
    this.assertOwned()
    const proof = this.installationEpoch(path)
    const stat = await this.disk.stat(path)
    this.assertOwned()
    if (!stat) return
    if (stat.type !== 'file' || stat.size !== size)
      throw new EngineError('conflict', 'Written file changed')
    if (existingOnly) {
      const current = this.installations.get(path) ?? this.receipts.get(path)
      const expectedHash = hash.clone().digest()
      if (
        !current?.installation ||
        !this.receiptStillBinds(current, path, stat) ||
        current.stamp.size !== size ||
        !current.hash
          .clone()
          .digest()
          .every((byte, index) => byte === expectedHash[index])
      ) {
        this.receipts.delete(path)
        this.installations.delete(path)
      }
      return
    }
    const receipt = this.installationReceipt(hash.clone(), stampOf(stat), proof)
    this.receipts.set(path, receipt)
    this.installations.set(path, receipt)
  }
  /** A sequence of acknowledged writes of an already-owned complete payload. */
  async writeWithReceipt(
    path: string,
    bytes: Uint8Array,
    write: () => Promise<void>,
    steps: readonly string[]
  ): Promise<void> {
    const hash = sha256.create()
    for (let at = 0; at < bytes.length; at += MAX_CHUNK_BYTES) {
      const chunk = bytes.subarray(at, at + MAX_CHUNK_BYTES)
      hash.update(chunk)
      const pause = this.taskBudget.account(chunk.length)
      if (pause !== undefined) await pause
    }
    const witnesses = await this.witness(bytes)
    const mutation = this.observeReceiptMutation([path], false, steps, { hash, witnesses })
    this.receipts.delete(path)
    try {
      await write()
      const stat = await this.disk.stat(path)
      const proof = mutation.proof()
      if (
        !stat ||
        stat.type !== 'file' ||
        stat.size !== bytes.length ||
        !proof ||
        !mutation.owned()
      )
        return
      const written = mutation.written()
      if (mutation.compound() && written?.size !== stat.size) return
      const compound =
        steps.some((step) => step === 'appendBinary') && written?.size === bytes.length
      const actual = compound ? written.hash : hash
      const digest = hash.clone().digest()
      const installed = actual
        .clone()
        .digest()
        .every((byte, index) => byte === digest[index])
      this.receipts.set(
        path,
        this.installationReceipt(
          actual,
          stampOf(stat),
          proof,
          installed,
          installed ? witnesses : undefined
        )
      )
    } finally {
      mutation.stop()
    }
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
  async adoptReceipt(from: string, to: string, move?: () => Promise<void>): Promise<void> {
    const receipt = this.receipts.get(from)
    // A completed move without an observed transfer has no byte provenance at its destination.
    if (!move) {
      this.receipts.delete(from)
      this.installations.delete(from)
      const current = this.receipts.get(to)
      if (current && !this.receiptStillBinds(current, to, await this.stat(to))) {
        this.receipts.delete(to)
        this.installations.delete(to)
      }
      return
    }
    const before = receipt ? await this.stat(from) : undefined
    const bound = before && this.receiptStillBinds(receipt, from, before)
    const sourceProof = receipt?.binding
    const mutation = this.observeReceiptMutation([from, to], true)
    try {
      await move()
      const current = await this.stat(to)
      const proof = mutation.proof()
      if (
        bound &&
        receipt &&
        proof &&
        this.receipts.get(from) === receipt &&
        receipt.binding === sourceProof
      ) {
        const candidate: WriteReceipt = {
          hash: receipt.hash.clone(),
          stamp: receipt.stamp,
          binding: proof,
          ...(receipt.installation ? { installation: proof } : {}),
        }
        if (this.receiptStillBinds(candidate, to, current)) {
          const installed = { ...candidate, stamp: stampOf(current) }
          this.receipts.set(to, installed)
          if (installed.installation) this.installations.set(to, installed)
          return
        }
      }
      this.receipts.delete(to)
      this.installations.delete(to)
    } finally {
      mutation.stop()
      this.receipts.delete(from)
      this.installations.delete(from)
    }
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
    if (
      receipt &&
      this.receiptStillBinds(receipt, path, await this.stat(path)) &&
      this.receipts.get(path) === receipt
    )
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
  openRead(path: string, expected?: SourceStamp, maxBytes?: number): Promise<ChunkSource> {
    return this.openSource(path, expected, false, undefined, false, maxBytes)
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
    requireChunks = false,
    maxBytes?: number
  ): Promise<ChunkSource> {
    const original = stampOf(await this.stat(path))
    // Enforce sweep admission before a mobile source can eagerly load bytes.
    if (maxBytes !== undefined && original.size > maxBytes)
      throw new EngineError('conflict', `${path} exceeds its admitted read size`)
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
      const eagerLimit = maxBytes === undefined ? PHONE_FALLBACK_BYTES : EAGER_READ_CAP
      if (!wholeFileUpload && original.size > eagerLimit)
        throw new EngineError(
          'io',
          `Bounded file reads are unavailable; the fallback limit is ${eagerLimit / 1024 / 1024} MiB`
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
    if (this.receiptStillBinds(receipt, path, stat)) {
      const identity = {
        size: stat.size,
        sha: Array.from(receipt.hash.clone().digest(), (byte) =>
          byte.toString(16).padStart(2, '0')
        ).join(''),
      }
      if (
        acknowledged?.(identity) &&
        this.receiptStillBinds(receipt, path, stat) &&
        this.receipts.get(path) === receipt
      )
        return { ...stampOf(stat), ...identity }
    }
    const proof = this.installationEpoch(path)
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
      this.receipts.set(path, this.installationReceipt(hash, source.stamp, proof, false))
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
      const stat = await this.stat(path)
      if (this.receiptStillBinds(receipt, path, stat) && this.receipts.get(path) === receipt)
        return {
          ...stampOf(stat),
          sha: Array.from(receipt.hash.clone().digest(), (byte) =>
            byte.toString(16).padStart(2, '0')
          ).join(''),
        }
      this.receipts.delete(path)
      if (this.metadataReceipts && stat.size > PHONE_FALLBACK_BYTES)
        throw new EngineError('conflict', 'Recorded file changed; file kept')
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
    const proof = this.installationEpoch(path)
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
    this.receipts.set(path, this.installationReceipt(hash, source.stamp, proof, false))
    return { ...source.stamp, ...identity }
  }
  async create(
    path: string,
    mtime: number,
    durability: 'acknowledged' | 'deferred' = 'acknowledged',
    initial = new Uint8Array()
  ): Promise<void> {
    this.assertOwned()
    if (initial.length > MOBILE_WHOLE_READ_MAX || initial.buffer.byteLength > MOBILE_WHOLE_READ_MAX)
      throw new EngineError('io', 'oversized buffered staging write')
    const hash = sha256.create()
    for (let at = 0; at < initial.length; at += MAX_CHUNK_BYTES) {
      const chunk = initial.subarray(at, at + MAX_CHUNK_BYTES)
      hash.update(chunk)
      const pause = this.taskBudget.account(chunk.length)
      if (pause !== undefined) await pause
    }
    const witnesses = await this.witness(initial)
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
      for (let at = 0; at < initial.length; at += MAX_CHUNK_BYTES)
        await this.append(
          path,
          at,
          initial.slice(at, at + MAX_CHUNK_BYTES),
          mtime,
          undefined,
          durability
        )
    } else {
      this.receipts.delete(path)
      const mutation = this.observeReceiptMutation([path], false, 'writeBinary', {
        hash,
        witnesses,
      })
      try {
        await this.disk.writeBinary(path, bytesOf(initial), { mtime })
        const stamp = stampOf(await this.stat(path))
        if (stamp.size !== initial.length)
          throw new EngineError('conflict', 'Created staging file changed')
        const proof = mutation.proof()
        const actual = mutation.written()?.hash ?? hash
        const digest = hash.clone().digest()
        const matches = actual
          .clone()
          .digest()
          .every((byte, index) => byte === digest[index])
        if (proof)
          this.receipts.set(
            path,
            this.installationReceipt(
              actual,
              stamp,
              proof,
              mutation.owned() && matches,
              matches ? witnesses : undefined
            )
          )
      } finally {
        mutation.stop()
      }
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
      const stat = await this.stat(path)
      const before = stampOf(stat)
      let receipt = this.receipts.get(path)
      if (!this.receiptStillBinds(receipt, path, stat)) {
        this.receipts.delete(path)
        if (before.size > PHONE_FALLBACK_BYTES && !(await this.canReplayStage()))
          throw new EngineError(
            'io',
            'Bounded staging recovery is unavailable; the fallback limit is 50 MiB'
          )
        const hash = sha256.create()
        const binding = this.installationEpoch(path)
        const source = await this.openRead(path)
        try {
          for (let at = 0; at < source.size; at += MAX_CHUNK_BYTES)
            hash.update(await source.read(at, Math.min(MAX_CHUNK_BYTES, source.size - at), signal))
          await source.assertUnchanged()
        } finally {
          await source.close()
        }
        receipt = this.installationReceipt(hash, before, binding, false)
        if (!this.receiptStillBinds(receipt, path, await this.stat(path)))
          throw new EngineError('conflict', 'Staging prefix changed while reading')
      }
      // An uncertain append cannot contribute an acknowledged identity.
      this.receipts.delete(path)
      const intended: WriteReceipt['hash'] = receipt.hash.clone().update(bytes)
      const witnesses = receipt.witnesses
        ? [...receipt.witnesses, ...(await this.witness(bytes))]
        : undefined
      if (!this.receiptStillBinds(receipt, path, stat))
        throw new EngineError('conflict', 'Staging prefix changed before append')
      const mutation = this.observeReceiptMutation(
        [path],
        false,
        typeof this.disk.appendBinary === 'function' ? 'appendBinary' : 'writeBinary',
        witnesses ? { hash: intended, witnesses } : undefined
      )
      try {
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
        const proof = mutation.proof()
        const written = mutation.written()
        if (proof && (!written || written.size === stamp.size)) {
          const actual = written?.hash ?? intended
          const digest = intended.clone().digest()
          const installed =
            !!receipt.installation &&
            mutation.owned() &&
            actual
              .clone()
              .digest()
              .every((byte, index) => byte === digest[index])
          this.receipts.set(
            path,
            this.installationReceipt(
              actual,
              stamp,
              proof,
              installed,
              installed ? witnesses : undefined
            )
          )
        }
      } finally {
        mutation.stop()
      }
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
