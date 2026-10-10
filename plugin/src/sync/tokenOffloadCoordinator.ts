import {
  sha256,
  type FileSystem,
  type FileInfo,
  type StateStore,
  type StateEntry,
} from '@abele/sync-core'
import { caseKey } from '@abele/sync-protocol'
import type { PathCoordinator } from './pathCoordinator'

type Provider = {
  ledger: StateStore
  assertOwned(): void
  includes(path: string): boolean
  verify(head: StateEntry): Promise<void>
  download(head: StateEntry): Promise<Uint8Array>
}
/** A shared view of journalled intentional absence. Sources remain independently authorized;
 * content is never selected by digest alone and network work never owns a placement lease. */
export class TokenOffloadCoordinator {
  private providers = new Map<string, Provider>()
  private absent = new Map<string, { files: FileInfo[]; artifacts: string[] }>()
  private hydration = new Map<string, (path: string) => Promise<void>>()
  private inflight = new Map<string, Promise<void>>()
  constructor(readonly locks: PathCoordinator) {}
  register(id: string, provider: Provider): () => void {
    this.providers.set(id, provider)
    return () => {
      if (this.providers.get(id) === provider) this.providers.delete(id)
      this.hydration.delete(id)
    }
  }
  remember(id: string, files: FileInfo[], artifacts: string[]): void {
    this.absent.set(id, { files: structuredClone(files), artifacts: [...artifacts] })
  }
  hydrator(id: string, work: (path: string) => Promise<void>): void {
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
  async download(preferred: string, head: StateEntry): Promise<Uint8Array> {
    const candidates = [...this.providers].sort(
      ([a], [b]) => Number(b === preferred) - Number(a === preferred)
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
  async authorize(head: { path: string; sha: string; size: number }): Promise<void> {
    for (const provider of this.providers.values()) {
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
  async prepare(paths: readonly string[]): Promise<void> {
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
            running = hydrate(file.path)
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
        if (method === 'read')
          return async (path: string) => {
            if (artifact(path)) throw new Error('Projection is not file content')
            if (!(await target.stat(path))) await this.prepare([path])
            return target.read(path)
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
