import { mobileLargeFileGate, MOBILE_LARGE_SOURCE, isLargeMobileFile } from '../mobileLargeFileGate'
import { vaultDisk, guardedVaultAdapter } from '../vaultPathLinks'
import { connectionHost, connectionPrivateArea } from '../connectionPaths'
import type { App, DataAdapter, EventRef } from 'obsidian'
import { caseKey } from '@abele/sync-sdk/protocol'
import { nativeOf } from '../nativeVaultFs'
import { bytesOf } from '../vaultWrites'
import { makeParents } from '../vaultFolders'
import { sha256 as incremental } from '@noble/hashes/sha2'
import { chunks, type ChunkSource } from '@abele/sync-sdk/core'
import { BoundedVaultIo } from '../boundedVaultIo'
import { stagingDirectory } from '../stagingDirectory'
import { transferBudgetOf } from '../transferBudget'
import { ExchangeTrace } from '../exchangeTrace'
const fileOperations = new ExchangeTrace()
export const externalFileSnapshot = () => fileOperations.snapshot()
import type { PathCoordinator } from '../pathCoordinator'
import {
  ExternalFileCoordination,
  type ExternalReservationRequest,
  type ExternalSerialization,
} from './coordination'
import {
  ExternalFileEffects,
  ExternalFilePortError,
  type ExternalEffectGuards,
  type ExternalFilesystemPort,
  type ExternalByteExpectation,
} from './filesystem'

const coordinators = new WeakMap<object, ExternalFileCoordination>()
/** One reservation authority for personal/scoped/rebuilt filesystems in this vault runtime. */
export function externalCoordinationOf(vault: object): ExternalFileCoordination {
  vault = connectionHost(vault)
  let coordinator = coordinators.get(vault)
  if (!coordinator) {
    coordinator = new ExternalFileCoordination()
    coordinators.set(vault, coordinator)
  }
  return coordinator
}

export interface ExternalHostOptions {
  platform: 'desktop' | 'mobile'
  /** The runtime fence's point-of-effect check; no permissive production default. */
  assertOwned(): void
  /** Optional runtime effect tracker, so successor runtimes settle already-issued effects. */
  effect?<T>(work: () => T): T
  reconciled?(path: string): void
  placement?: PathCoordinator
  beforeRemoval?(path: string): Promise<void>
  assertRemovalAllowed?(path: string): void
  stagingMtime?(path: string): number
}
export interface ExternalHostRequest extends ExternalReservationRequest {
  /** Backed by the committed operation and server-verified basis in the later attachment API. */
  assertIntent: ExternalEffectGuards['assertIntent']
}

/** Thin Obsidian port. No automatic caller or UI: attachment API composition comes later. */
export class ExternalFileHost {
  readonly coordination: ExternalFileCoordination
  private readonly refs: EventRef[] = []
  private readonly leases = new Set<{ release(): void }>()
  private closed = false
  private readonly io: BoundedVaultIo
  constructor(
    private readonly app: App,
    private readonly options: ExternalHostOptions
  ) {
    this.coordination = externalCoordinationOf(app.vault)
    this.io = new BoundedVaultIo(
      vaultDisk(app.vault),
      this.assertOwned,
      undefined,
      undefined,
      app.vault.configDir,
      connectionPrivateArea(app),
      options.platform === 'mobile'
    )
    const opened = (file?: { path?: string } | null) => {
      this.coordination.opened([...this.openPaths(), ...(file?.path ? [file.path] : [])])
    }
    this.refs.push(app.workspace.on('file-open', opened))
    this.refs.push(app.workspace.on('layout-change', () => opened()))
    this.refs.push(app.workspace.on('active-leaf-change', () => opened()))
  }

  private assertOwned = (): void => {
    if (this.closed) throw new ExternalFilePortError('recovery-required')
    this.options.assertOwned()
  }
  artifactPath(name: string): string {
    return `${connectionPrivateArea(this.app) ? connectionPrivateArea(this.app) + '/external' : stagingDirectory(this.app.vault.configDir)}/${name}`
  }
  private effect<T>(work: () => T): T {
    this.assertOwned()
    return this.options.effect ? this.options.effect(work) : work()
  }
  private openPaths(): string[] {
    const paths: string[] = []
    // Includes nonactive, non-Markdown and split leaves; the active editor is insufficient.
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as typeof leaf.view & { file?: { path: string } | null }
      if (view.file?.path) paths.push(view.file.path)
      const state = view.getState?.() as { file?: unknown } | undefined
      if (typeof state?.file === 'string') paths.push(state.file)
    })
    return paths
  }
  private assertUnused(paths: readonly string[]): void {
    const keys = paths.map(caseKey)
    if (this.openPaths().some((path) => keys.includes(caseKey(path))))
      throw new ExternalFilePortError('busy')
  }
  async read(path: string): Promise<Uint8Array> {
    this.assertOwned()
    const bytes = new Uint8Array(
      await fileOperations.run(
        'readBinary',
        () => guardedVaultAdapter(vaultDisk(this.app.vault)).readBinary(path),
        true
      )
    )
    this.assertOwned()
    return bytes
  }
  async exists(path: string): Promise<boolean> {
    this.assertOwned()
    return guardedVaultAdapter(vaultDisk(this.app.vault)).exists(path)
  }
  openRead(path: string): Promise<ChunkSource> {
    return this.io.openRead(path)
  }
  async requireTransfer(size: number): Promise<void> {
    try {
      await this.io.requireWrite(size)
    } catch {
      throw new ExternalFilePortError('unsupported-storage')
    }
  }
  /** Native bounded reads on desktop; the mobile adapter exposes only readBinary. */
  async matches(expected: ExternalByteExpectation): Promise<boolean> {
    if (
      !(await vaultDisk(this.app.vault).stat(expected.path)) &&
      expected.size <= 50 * 1024 * 1024
    ) {
      const bytes = await this.read(expected.path)
      const sha = Array.from(incremental(bytes), (byte) => byte.toString(16).padStart(2, '0')).join(
        ''
      )
      return bytes.length === expected.size && sha === expected.sha
    }
    const actual = await this.fingerprint(expected.path)
    return actual.size === expected.size && actual.sha === expected.sha
  }
  async fingerprint(path: string): Promise<{ size: number; sha: string }> {
    return fileOperations.run('fingerprint', () => this.fingerprintBytes(path), true)
  }
  private async fingerprintBytes(path: string): Promise<{ size: number; sha: string }> {
    const { size, sha } = await this.io.fingerprint(path)
    return { size, sha }
  }
  acquireUse(fileId: string): { release(): void } {
    this.assertOwned()
    const lease = this.coordination.acquireUse(fileId)
    const owned = {
      release: () => {
        lease.release()
        this.leases.delete(owned)
      },
    }
    this.leases.add(owned)
    return owned
  }
  /** Runs the removal hook before an operation reserves `path`. Whatever the hook writes for
   * the engine (a copy owed to another connection) is refused once the reservation holds it. */
  async prepareRemoval(path: string): Promise<void> {
    this.assertOwned()
    await this.options.beforeRemoval?.(path)
  }
  assertRemovalAllowed(path: string): void {
    this.assertOwned()
    this.options.assertRemovalAllowed?.(path)
  }
  close(): void {
    this.closed = true
    for (const lease of this.leases) lease.release()
    for (const ref of this.refs) this.app.workspace.offref(ref)
    this.refs.length = 0
  }

  async run<T>(
    serial: ExternalSerialization,
    request: ExternalHostRequest,
    work: (effects: ExternalFileEffects) => Promise<T>
  ): Promise<T> {
    if (typeof request.assertIntent !== 'function')
      throw new ExternalFilePortError('recovery-required')
    // Capture before an exclusive job waits: callers must not redirect a queued reservation
    // by mutating the original request or its paths array.
    const intake = Object.freeze({ ...request, paths: Object.freeze([...request.paths]) })
    return serial.run(async () => {
      this.assertOwned()
      const reservation = this.coordination.reserve(intake)
      let effects: ExternalFileEffects | undefined
      try {
        this.assertUnused(reservation.request.paths)
        effects = new ExternalFileEffects(this.filesystem(), reservation, {
          assertOwned: this.assertOwned,
          assertUnused: () => this.assertUnused(reservation.request.paths),
          assertIntent: (phase, paths, artifact) => {
            if (phase === 'delete-original')
              for (const path of paths) this.options.assertRemovalAllowed?.(path)
            intake.assertIntent(phase, paths, artifact)
          },
        })
        return await work(effects)
      } finally {
        await effects?.settle()
        reservation.release()
      }
    })
  }

  private filesystem(): ExternalFilesystemPort {
    const adapter = vaultDisk(this.app.vault)
    const native = nativeOf(
      adapter,
      this.assertOwned,
      connectionPrivateArea(this.app) ? connectionPrivateArea(this.app) + '/recovery' : undefined
    )
    const installation =
      this.options.platform === 'desktop'
        ? native?.installExclusive
          ? 'native-link'
          : 'unavailable'
        : 'adapter-rename'
    const mutateAdapter = new Proxy(adapter, {
      get: (target, key) => {
        const value = Reflect.get(target, key)
        if (typeof value !== 'function') return value
        // Native filesystem calls require the adapter's synchronous path mapping.
        if (key === 'getFullPath' || key === 'getResourcePath') return value.bind(target)
        return (...args: unknown[]) => {
          const work = async () => {
            this.assertOwned()
            if (key === 'remove') {
              await this.options.beforeRemoval?.(args[0] as string)
              // Synchronous permission check inside the placement lock, after all awaits.
              this.options.assertRemovalAllowed?.(args[0] as string)
            }
            return this.effect(() => value.apply(target, args))
          }
          const paths =
            typeof args[0] === 'string'
              ? [args[0], ...(key === 'rename' && typeof args[1] === 'string' ? [args[1]] : [])]
              : []
          return fileOperations.run(
            String(key),
            () =>
              this.options.placement && paths.length
                ? this.options.placement.run(paths, work, this.assertOwned)
                : work(),
            true
          )
        }
      },
    })
    return {
      installation,
      exists: (path) => adapter.exists(path),
      read: (path) => this.read(path),
      matches: (expected) => this.matches(expected),
      makeParents: (path) => makeParents(mutateAdapter, path),
      writeStaging: async (path, bytes, assertEffect) => {
        const chunkSize = 1024 * 1024
        // CapacitorAdapter gained appendBinary in 1.12.3. Check the actual runtime:
        // older/custom adapters retain the whole-write path and all disk rechecks.
        if (
          this.options.platform !== 'mobile' ||
          typeof adapter.appendBinary !== 'function' ||
          bytes.length <= chunkSize
        ) {
          assertEffect()
          if (this.options.stagingMtime)
            await mutateAdapter.writeBinary(path, bytesOf(bytes), {
              mtime: this.options.stagingMtime(path),
            })
          else await mutateAdapter.writeBinary(path, bytesOf(bytes))
          return
        }
        const hash = incremental.create()
        for (let at = 0; at < bytes.length; at += chunkSize) {
          // A view would expose its full backing buffer to the base64 bridge.
          const chunk = bytes.slice(at, at + chunkSize)
          assertEffect()
          await this.effect(() =>
            at === 0
              ? this.options.stagingMtime
                ? mutateAdapter.writeBinary(path, chunk.buffer, {
                    mtime: this.options.stagingMtime(path),
                  })
                : mutateAdapter.writeBinary(path, chunk.buffer)
              : mutateAdapter.appendBinary(path, chunk.buffer)
          )
          hash.update(chunk)
        }
        assertEffect()
        await this.io.recordWrite(path, bytes.length, hash)
      },
      writeStagingSource: async (path, source, expected, assertEffect, signal) => {
        await transferBudgetOf(this.app.vault).run(async () => {
          const releaseLarge =
            this.options.platform === 'mobile' &&
            isLargeMobileFile(expected.size) &&
            !Reflect.get(source, MOBILE_LARGE_SOURCE)
              ? await mobileLargeFileGate.acquire(signal)
              : undefined
          try {
            // Writes use the same guarded placement/effect adapter as whole-byte callers.
            const io = new BoundedVaultIo(
              mutateAdapter,
              () => {
                this.assertOwned()
                assertEffect()
              },
              (work) => this.effect(work),
              vaultDisk(this.app.vault),
              this.app.vault.configDir,
              undefined,
              this.options.platform === 'mobile'
            )
            const mtime = this.options.stagingMtime?.(path) ?? Date.now()
            assertEffect()
            await io.create(path, mtime)
            const hash = incremental.create()
            let offset = 0
            for await (const bytes of chunks(source, 1024 * 1024, signal)) {
              assertEffect()
              hash.update(bytes)
              await io.append(path, offset, bytes, mtime, signal)
              offset += bytes.length
            }
            const sha = Array.from(hash.digest(), (byte) =>
              byte.toString(16).padStart(2, '0')
            ).join('')
            if (offset !== expected.size || sha !== expected.sha)
              throw new ExternalFilePortError('local-changed')
          } finally {
            releaseLarge?.()
          }
        }, signal)
      },
      install: async (from, to, assertEffect) => {
        if (installation === 'native-link') {
          assertEffect()
          const work = () => this.effect(() => native.installExclusive(from, to))
          await (this.options.placement
            ? this.options.placement.run([from, to], work, this.assertOwned)
            : work())
          return
        }
        if (installation !== 'adapter-rename')
          throw new ExternalFilePortError('unsupported-storage')
        // Recheck immediately before rename, after every other awaited preparation/check.
        // The adapter also refuses a preexisting occupant. Its internal check/native-rename
        // interval is NOT an atomic no-clobber guarantee; that residual risk is accepted.
        if (await adapter.exists(to)) throw new ExternalFilePortError('collision')
        assertEffect()
        await mutateAdapter.rename(from, to)
        await this.io.adoptReceipt(from, to)
      },
      removeOriginal: (path) => mutateAdapter.remove(path),
      moveOwned: async (from, to) => {
        if (await adapter.exists(to)) throw new ExternalFilePortError('collision')
        await mutateAdapter.rename(from, to)
        await this.io.adoptReceipt(from, to)
      },
      reconcile: async (paths) => {
        const raw = adapter as DataAdapter & {
          reconcileInternalFile?: (path: string) => Promise<void>
        }
        for (const path of paths) {
          this.assertOwned()
          const reconcile = raw.reconcileInternalFile?.bind(adapter)
          if (reconcile) {
            try {
              await this.effect(() => reconcile(path))
            } catch {
              /* Index notification is not filesystem outcome evidence. */
            }
          }
          this.assertOwned()
          this.options.reconciled?.(path)
        }
      },
    }
  }
}
