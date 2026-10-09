import type { App, DataAdapter, EventRef } from 'obsidian'
import { caseKey } from '@abele/sync-protocol'
import { nativeOf } from '../nativeVaultFs'
import { bytesOf } from '../vaultWrites'
import { makeParents } from '../vaultFolders'
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
} from './filesystem'

const coordinators = new WeakMap<object, ExternalFileCoordination>()
/** One reservation authority for personal/scoped/rebuilt filesystems in this vault runtime. */
export function externalCoordinationOf(vault: object): ExternalFileCoordination {
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
  constructor(
    private readonly app: App,
    private readonly options: ExternalHostOptions
  ) {
    this.coordination = externalCoordinationOf(app.vault)
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
    const bytes = new Uint8Array(await this.app.vault.adapter.readBinary(path))
    this.assertOwned()
    return bytes
  }
  async exists(path: string): Promise<boolean> {
    this.assertOwned()
    return this.app.vault.adapter.exists(path)
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
          assertIntent: intake.assertIntent,
        })
        return await work(effects)
      } finally {
        await effects?.settle()
        reservation.release()
      }
    })
  }

  private filesystem(): ExternalFilesystemPort {
    const adapter = this.app.vault.adapter
    const native = nativeOf(adapter, this.assertOwned)
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
        return (...args: unknown[]) => this.effect(() => value.apply(target, args))
      },
    })
    return {
      installation,
      exists: (path) => adapter.exists(path),
      read: async (path) => new Uint8Array(await adapter.readBinary(path)),
      makeParents: (path) => makeParents(mutateAdapter, path),
      writeStaging: (path, bytes) => this.effect(() => adapter.writeBinary(path, bytesOf(bytes))),
      install: async (from, to, assertEffect) => {
        if (installation === 'native-link') {
          assertEffect()
          await this.effect(() => native.installExclusive(from, to))
          return
        }
        if (installation !== 'adapter-rename')
          throw new ExternalFilePortError('unsupported-storage')
        // Recheck immediately before rename, after every other awaited preparation/check.
        // The adapter also refuses a preexisting occupant. Its internal check/native-rename
        // interval is NOT an atomic no-clobber guarantee; that residual risk is accepted.
        if (await adapter.exists(to)) throw new ExternalFilePortError('collision')
        assertEffect()
        await this.effect(() => adapter.rename(from, to))
      },
      removeOriginal: (path) => this.effect(() => adapter.remove(path)),
      moveOwned: async (from, to) => {
        if (await adapter.exists(to)) throw new ExternalFilePortError('collision')
        await this.effect(() => adapter.rename(from, to))
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
