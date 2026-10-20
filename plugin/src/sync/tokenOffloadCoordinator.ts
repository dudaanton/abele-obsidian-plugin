import { MOBILE_LARGE_SOURCE } from './mobileLargeFileGate'
import { sha256 } from './external/hash'
import {
  type FileSystem,
  type FileInfo,
  type StateStore,
  type StateEntry,
  type ChunkSource,
} from '@abele/sync-sdk/core'
import { caseKey } from '@abele/sync-sdk/protocol'
import type { PathCoordinator } from './pathCoordinator'
import type { Projection } from './external/projection'

export type ExternalDescription = Projection & { changed: boolean; available: boolean }
export type TransferProgress = { done: number; total: number }

type Provider = {
  ledger: StateStore
  assertOwned(): void
  includes(path: string): boolean
  available?(): boolean
  verify(head: StateEntry): Promise<void>
  download(head: StateEntry): Promise<Uint8Array>
  openVersion?(head: StateEntry, signal?: AbortSignal): Promise<ChunkSource>
  describe?(path: string): Promise<ExternalDescription | null>
}
/** A shared view of journalled intentional absence. Sources remain independently authorized;
 * content is never selected by digest alone and network work never owns a placement lease. */
export class TokenOffloadCoordinator {
  private providers = new Map<string, Provider>()
  private absent = new Map<string, { files: FileInfo[]; artifacts: string[] }>()
  private hydration = new Map<string, (path: string, signal?: AbortSignal) => Promise<void>>()
  private inflight = new Map<string, Promise<void>>()
  private listeners = new Set<() => void>()
  private transfers = new Map<string, TransferProgress>()
  private cancellations = new Map<string, () => void>()
  private descriptions = new Map<string, ExternalDescription>()
  rememberDescription(description: ExternalDescription): void {
    this.descriptions.set(caseKey(description.path), { ...description })
  }
  cancellable(path: string, cancel: () => void): () => void {
    const key = caseKey(path)
    this.cancellations.set(key, cancel)
    return () => {
      if (this.cancellations.get(key) === cancel) this.cancellations.delete(key)
    }
  }
  cancel(path: string): void {
    this.cancellations.get(caseKey(path))?.()
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  changed(): void {
    for (const listener of this.listeners) listener()
  }
  transfer(path: string): TransferProgress | undefined {
    return this.transfers.get(caseKey(path))
  }
  progress(path: string, value?: TransferProgress): void {
    if (value) this.transfers.set(caseKey(path), value)
    else this.transfers.delete(caseKey(path))
    this.changed()
  }
  async describe(path: string): Promise<ExternalDescription | null> {
    const providers = [...this.providers.values()].sort(
      (a, b) => Number(b.available?.() ?? true) - Number(a.available?.() ?? true)
    )
    for (const provider of providers) {
      if (provider.includes(path) && provider.describe) {
        try {
          provider.assertOwned()
        } catch {
          continue
        }
        const detail = await provider.describe(path)
        if (detail) {
          this.rememberDescription(detail)
          return detail
        }
      }
    }
    const cached = this.descriptions.get(caseKey(path))
    return cached ? { ...cached, available: false } : null
  }
  constructor(readonly locks: PathCoordinator) {}
  /** Pool reset drains providers first. Keep the object held by registered UI handlers. */
  clearDrainedState(): void {
    if (this.providers.size || this.inflight.size)
      throw new Error('External file access must be drained before clearing state')
    this.absent.clear()
    this.descriptions.clear()
    this.transfers.clear()
    this.cancellations.clear()
    this.hydration.clear()
    this.changed()
  }
  register(id: string, provider: Provider): () => void {
    this.providers.set(id, provider)
    return () => {
      if (this.providers.get(id) === provider) this.providers.delete(id)
      this.hydration.delete(id)
      this.changed()
    }
  }
  remember(id: string, files: FileInfo[], artifacts: string[]): void {
    this.absent.set(id, { files: structuredClone(files), artifacts: [...artifacts] })
    this.changed()
  }
  hydrator(id: string, work: (path: string, signal?: AbortSignal) => Promise<void>): void {
    this.hydration.set(id, work)
  }
  originalPath(path: string): string {
    return (
      [...this.absent.values()]
        .flatMap((one) => one.files)
        .find((one) => caseKey(one.path + '.abele-ref') === caseKey(path))?.path ?? path
    )
  }
  isOffloaded(path: string): boolean {
    return [...this.absent.values()].some((one) =>
      one.files.some((file) => caseKey(file.path) === caseKey(path))
    )
  }
  files(): FileInfo[] {
    const files = new Map<string, FileInfo>()
    for (const snapshot of this.absent.values())
      for (const file of snapshot.files) files.set(caseKey(file.path), { ...file })
    return [...files.values()]
  }
  async download(preferred: string, head: StateEntry): Promise<Uint8Array> {
    const candidates = [...this.providers].sort(
      ([a, first], [b, second]) =>
        Number(second.available?.() ?? true) - Number(first.available?.() ?? true) ||
        Number(b === preferred) - Number(a === preferred)
    )
    for (const [, provider] of candidates) {
      try {
        provider.assertOwned()
        if (!provider.includes(head.path)) continue
        const own = await provider.ledger.get(head.path)
        if (!own || own.sha !== head.sha || own.size !== head.size) continue
        await provider.verify(own)
        provider.assertOwned()
        const bytes = await provider.download(own)
        provider.assertOwned()
        if (bytes.length !== head.size || (await sha256(bytes)) !== head.sha) continue
        return bytes
      } catch {
        /* An independent authorized source may still be available. */
      }
    }
    throw new Error('File content is unavailable through the current connections')
  }
  async openVersion(
    preferred: string,
    head: StateEntry,
    signal?: AbortSignal
  ): Promise<ChunkSource> {
    const candidates = [...this.providers].sort(
      ([a, first], [b, second]) =>
        Number(second.available?.() ?? true) - Number(first.available?.() ?? true) ||
        Number(b === preferred) - Number(a === preferred)
    )
    for (const [, provider] of candidates) {
      try {
        signal?.throwIfAborted()
        provider.assertOwned()
        if (!provider.includes(head.path) || !provider.openVersion) continue
        const own = await provider.ledger.get(head.path)
        if (!own || own.sha !== head.sha || own.size !== head.size) continue
        await provider.verify(own)
        provider.assertOwned()
        const source = await provider.openVersion(own, signal)
        try {
          provider.assertOwned()
          let done = 0
          return Object.assign(
            {
              size: source.size,
              signal: source.signal,
              ...(source.stamp ? { stamp: source.stamp } : {}),
              read: async (offset: number, length: number, cancellation?: AbortSignal) => {
                const bytes = await source.read(offset, length, cancellation)
                done = Math.max(done, offset + bytes.length)
                this.progress(head.path, { done, total: head.size })
                return bytes
              },
              assertUnchanged: () => source.assertUnchanged(),
              close: () => source.close(),
            },
            { [MOBILE_LARGE_SOURCE]: Reflect.get(source, MOBILE_LARGE_SOURCE) }
          )
        } catch (error) {
          await source.close()
          throw error
        }
      } catch {
        signal?.throwIfAborted()
      }
    }
    throw new Error('File content is unavailable through the current connections')
  }
  async authorize(head: { path: string; sha: string; size: number }): Promise<void> {
    const candidates = [...this.providers.values()].sort(
      (first, second) => Number(second.available?.() ?? true) - Number(first.available?.() ?? true)
    )
    for (const provider of candidates) {
      try {
        provider.assertOwned()
        const own = await provider.ledger.get(head.path)
        if (!provider.includes(head.path) || !own || own.sha !== head.sha || own.size !== head.size)
          continue
        await provider.verify(own)
        provider.assertOwned()
        return
      } catch {
        /* Other authorized sources are independent. */
      }
    }
    throw new Error('File content is unavailable through the current connections')
  }
  /** This source's absent files are settled as metadata by its representation client.
   * Other sources and parent placements still need the ordinary content preparation. */
  async prepareIncoming(owner: string, paths: readonly string[]): Promise<void> {
    const absent = this.absent.get(owner)?.files ?? []
    await this.prepare(
      paths.filter((path) => !absent.some((file) => caseKey(file.path) === caseKey(path)))
    )
  }
  async prepare(paths: readonly string[], signal?: AbortSignal): Promise<void> {
    for (const [id, snapshot] of this.absent)
      for (const file of snapshot.files)
        if (
          paths.some(
            (path) =>
              caseKey(path) === caseKey(file.path) ||
              caseKey(file.path).startsWith(caseKey(path) + '/')
          )
        ) {
          const key = caseKey(file.path)
          let running = this.inflight.get(key)
          if (running === undefined) {
            const hydrate = this.hydration.get(id)
            if (!hydrate)
              throw new Error('File content is unavailable until its connection recovers')
            running = signal ? hydrate(file.path, signal) : hydrate(file.path)
            this.inflight.set(key, running)
            void running
              .finally(() => {
                if (this.inflight.get(key) === running) this.inflight.delete(key)
              })
              .catch(() => {})
          }
          await running
        }
  }
  fileSystem(fs: FileSystem, includes: (path: string) => boolean, owner?: string): FileSystem {
    const virtual = () =>
      [...this.absent]
        .filter(([id]) => id !== owner)
        .flatMap(([, one]) => one.files)
        .filter((one) => includes(one.path))
    const artifact = (path: string) =>
      [...this.absent.values()].some((one) =>
        one.artifacts.some((item) => caseKey(item) === caseKey(path))
      )
    return new Proxy(fs, {
      get: (target, method) => {
        if (
          (method === 'listChildren' ||
            method === Symbol.for('abele.sync.inventory-children-v1')) &&
          Reflect.get(target, method)
        )
          return async (parent: string, path?: string) => {
            const children = (
              (await Reflect.get(target, method).call(target, parent, path)) as {
                path: string
                kind: 'file' | 'directory'
                identity?: string
              }[]
            ).filter((one) => !artifact(one.path))
            const seen = new Set(children.map((one) => caseKey(one.path)))
            for (const info of virtual())
              if (
                info.path.slice(0, Math.max(0, info.path.lastIndexOf('/'))) === parent &&
                !seen.has(caseKey(info.path))
              ) {
                seen.add(caseKey(info.path))
                children.push({ path: info.path, kind: 'file' })
              }
            return children
          }
        if (method === 'list')
          return async function* () {
            const seen = new Set<string>()
            for await (const info of target.list())
              if (!artifact(info.path)) {
                seen.add(caseKey(info.path))
                yield info
              }
            for (const info of virtual())
              if (!seen.has(caseKey(info.path))) {
                seen.add(caseKey(info.path))
                yield { ...info }
              }
          }
        if (method === 'stat')
          return async (path: string) =>
            artifact(path)
              ? null
              : ((await target.stat(path)) ??
                virtual().find((one) => caseKey(one.path) === caseKey(path)) ??
                null)
        if (method === 'read' || method === 'openRead' || method === 'fingerprint')
          return async (path: string, ...args: unknown[]) => {
            if (artifact(path)) throw new Error('Projection is not file content')
            if (!(await target.stat(path))) await this.prepare([path])
            return Reflect.get(target, method).call(target, path, ...args)
          }
        const value = Reflect.get(target, method)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
  }
}
const SHARED = Symbol.for('abele.sync.token-offloads-v1')
export function tokenOffloadsOf(vault: object, locks: PathCoordinator): TokenOffloadCoordinator {
  const host = vault as { [SHARED]?: TokenOffloadCoordinator }
  return (host[SHARED] ??= new TokenOffloadCoordinator(locks))
}
