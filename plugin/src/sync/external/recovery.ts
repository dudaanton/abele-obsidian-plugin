import { EngineError } from '@abele/sync-core'
import type { ExternalDocument } from './records'

export interface RecoveryStorage {
  loadLocalStorage(key: string): unknown
  saveLocalStorage(key: string, value: unknown): void
}
export const EXTERNAL_ACTIVATION_KEY = 'abele-sync-external-activation-v1'
export const EXTERNAL_SWITCH_KEY = 'abele-sync-external-connection-switch-v1'
export const EXTERNAL_GENERATION_KEY = 'abele-sync-external-generation-v1'
const OWNER_KEY = 'abele-sync-runtime-owner-v1:'
const effects = new Map<string, Set<Promise<unknown>>>()

export class ExternalRecoveryRequired extends Error {
  constructor(
    detail = 'retained external-file dependencies require recovery or disconnect preparation'
  ) {
    super(`External files: ${detail}. The connection and recovery evidence remain intact.`)
  }
}

/** Conservative connection hold until external classification and materialization are integrated. */
export function externalInventory(document: ExternalDocument): {
  files: number
  operations: number
  retainedBytes: number
  blocked: boolean
} {
  const artifacts = new Map<string, number>()
  for (const file of document.files)
    for (const item of file.retained) artifacts.set(item.path, item.size)
  for (const op of document.operations)
    for (const item of op.ownedArtifacts) artifacts.set(item.path, item.size)
  return {
    files: document.files.length,
    operations: document.operations.length,
    retainedBytes: [...artifacts.values()].reduce((sum, bytes) => sum + bytes, 0),
    blocked: document.files.length > 0 || document.operations.length > 0,
  }
}

export function assertNoExternalLifecycleMarker(storage: RecoveryStorage): void {
  if (
    storage.loadLocalStorage(EXTERNAL_ACTIVATION_KEY) != null ||
    storage.loadLocalStorage(EXTERNAL_SWITCH_KEY) != null
  )
    throw new ExternalRecoveryRequired()
}

/** A vault-local last-claim-wins fence, checked again at each actual effect invocation.
 * It coordinates plugin runtimes, not independent filesystem writers. */
export class RuntimeFence {
  private active = true
  private ready = false
  private readonly claim = crypto.randomUUID()
  private readonly key: string
  constructor(
    private readonly storage: RecoveryStorage,
    readonly database: string,
    private readonly current: () => boolean
  ) {
    this.key = OWNER_KEY + database
    storage.saveLocalStorage(this.key, this.claim)
    if (storage.loadLocalStorage(this.key) !== this.claim)
      throw new ExternalRecoveryRequired('runtime ownership was not persisted')
  }
  claimHeld(): boolean {
    try {
      return this.active && this.storage.loadLocalStorage(this.key) === this.claim
    } catch {
      return false
    }
  }
  assertClaim(): void {
    if (!this.claimHeld())
      throw new EngineError('lost', 'Runtime ownership lost; recovery required')
  }
  owns(): boolean {
    try {
      return this.active && this.storage.loadLocalStorage(this.key) === this.claim && this.current()
    } catch {
      return false
    }
  }
  assertOwned(): void {
    if (!this.owns())
      throw new EngineError('lost', 'Runtime ownership lost; no further sync effects are permitted')
  }
  assertReady(): void {
    this.assertOwned()
    if (!this.ready) throw new ExternalRecoveryRequired('startup recovery has not completed')
  }
  activate(): void {
    this.assertOwned()
    this.ready = true
  }
  release(): void {
    this.active = false
    this.ready = false
    if (this.storage.loadLocalStorage(this.key) === this.claim)
      this.storage.saveLocalStorage(this.key, null)
  }
  async settlePredecessors(): Promise<void> {
    for (;;) {
      this.assertOwned()
      const pending = [...(effects.get(this.database) ?? [])]
      if (!pending.length) return
      await Promise.allSettled(pending)
    }
  }
  /** Already-issued effects cannot be cancelled by this fence. Successors wait for them,
   * then inspect their durable journals; a stale continuation cannot retire the evidence. */
  effect<T>(work: () => T): T {
    this.assertOwned()
    const result = work()
    if (result instanceof Promise) {
      const pending = effects.get(this.database) ?? new Set<Promise<unknown>>()
      effects.set(this.database, pending)
      pending.add(result)
      void result
        .finally(() => {
          pending.delete(result)
          if (!pending.size && effects.get(this.database) === pending) effects.delete(this.database)
        })
        .catch(() => {})
    }
    return result
  }
}

/** Keep method receivers intact; checks apply to the exposed host client as well as core. */
export function fencedPort<T extends object>(
  target: T,
  fence: RuntimeFence,
  methods: readonly string[],
  ready = true
): T {
  return new Proxy(target, {
    get(object, key) {
      const value = Reflect.get(object, key)
      if (typeof value !== 'function') return value
      if (typeof key !== 'string' || !methods.includes(key)) return value.bind(object)
      return (...args: unknown[]) => {
        // Client methods are promise APIs. Refusals remain rejections for existing handlers.
        try {
          if (ready) fence.assertReady()
          return fence.effect(() => {
            const result = value.apply(object, args)
            if (result instanceof Promise)
              return result.then(
                (answer) => {
                  fence.assertOwned()
                  return answer
                },
                (error) => {
                  fence.assertOwned()
                  throw error
                }
              )
            fence.assertOwned()
            return result
          })
        } catch (error) {
          return Promise.reject(
            error instanceof Error ? error : new Error('Runtime effect refused', { cause: error })
          )
        }
      }
    },
  })
}
