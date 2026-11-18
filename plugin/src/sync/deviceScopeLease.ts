import { z } from 'zod'
import type { LocalStorage } from './ledgerId'
import { checkedDeviceScope } from './deviceScope'
import type { ShareItem } from './shareSets'

export const DEVICE_SCOPE_LEASE = 'abele-sync-token-state:device-scope-lease-v1'
const item = z
  .object({ kind: z.enum(['vault', 'folder', 'group', 'file']), id: z.string(), path: z.string() })
  .strict()
const owned = z
  .object({ id: z.string().min(1), reference: z.string().min(1), records: z.array(z.string()) })
  .strict()
const schema = z
  .object({
    selection: z.array(item).min(1).max(20),
    resolved: z.array(item).optional(),
    current: owned.optional(),
    pending: z
      .object({ label: z.string().min(1), resolved: z.array(item), issued: owned.optional() })
      .strict()
      .optional(),
    cleanup: z.array(owned),
  })
  .strict()
export type ScopeLeaseState = z.infer<typeof schema>

/** No file deletion or source-key revocation port exists in this lifecycle. */
export interface ScopeLeasePorts {
  stop(): Promise<void>
  resolve(items: ShareItem[]): Promise<ShareItem[]>
  tokens(): Promise<{ id: string; label: string }[]>
  issue(items: ShareItem[], label: string): Promise<{ id: string; token: string }>
  retain(token: string): Promise<string>
  load(reference: string): string | null
  drop(reference: string): Promise<void>
  install(token: string): Promise<string[]>
  activate(records: string[]): Promise<void>
  forget(records: string[]): Promise<void>
  revoke(id: string): Promise<void>
}

/** Serialized, device-local ownership of the same scoped keys used by Share. */
export class DeviceScopeLease {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly local: LocalStorage,
    private readonly ports: ScopeLeasePorts
  ) {}

  snapshot(): ScopeLeaseState | null {
    const raw = this.local.loadLocalStorage(DEVICE_SCOPE_LEASE)
    if (raw == null) return null
    const parsed = schema.safeParse(raw, { jitless: true })
    if (!parsed.success) throw new Error('Device scope lifecycle requires recovery')
    checkedDeviceScope(parsed.data.selection)
    return parsed.data
  }
  private save(state: ScopeLeaseState | null): void {
    const value = state === null ? null : schema.parse(state, { jitless: true })
    this.local.saveLocalStorage(DEVICE_SCOPE_LEASE, value)
    if (JSON.stringify(this.snapshot()) !== JSON.stringify(value))
      throw new Error('Device scope lifecycle could not be saved')
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => {}).then(work)
    this.queue = next
    return next
  }
  private async clean(state: ScopeLeaseState): Promise<void> {
    while (state.cleanup.length) {
      const retiring = state.cleanup[0]
      await this.ports.revoke(retiring.id)
      await this.ports.forget(retiring.records)
      await this.ports.drop(retiring.reference)
      state.cleanup.shift()
      this.save(state)
    }
  }
  change(selection: ShareItem[], signal?: AbortSignal): Promise<void> {
    const chosen = checkedDeviceScope(selection)
    return this.serialize(async () => {
      const active = () => signal?.throwIfAborted()
      active()
      let state = this.snapshot()
      if (
        state?.current &&
        !state.pending &&
        !state.cleanup.length &&
        JSON.stringify(state.selection) === JSON.stringify(chosen)
      ) {
        await this.ports.activate(state.current.records)
        return
      }
      if (!state) {
        state = { selection: chosen, cleanup: [] }
        this.save(state)
      }
      await this.ports.stop()
      active()
      if (!state) state = { selection: chosen, cleanup: [] }
      if (state.pending && JSON.stringify(state.selection) !== JSON.stringify(chosen)) {
        if (state.pending.issued) state.cleanup.push(state.pending.issued)
        else
          for (const token of await this.ports.tokens())
            if (token.label === state.pending.label) await this.ports.revoke(token.id)
        delete state.pending
      }
      if (state.current) {
        state.cleanup.push(state.current)
        delete state.current
      }
      state.selection = chosen
      this.save(state)
      await this.clean(state)
      active()
      if (!state.pending) {
        // Save the choice before bootstrap or issuance. A failed preparation stays narrow.
        const resolved = await this.ports.resolve(chosen)
        active()
        state.resolved = chosen.map((item, index) => ({ ...item, id: resolved[index].id }))
        state.pending = { label: 'Device scope ' + crypto.randomUUID(), resolved }
        this.save(state)
      }
      const pending = state.pending
      if (!pending.issued) {
        // Issuance responses cannot be reconstructed from token listings. Revoke an
        // uncertain response by its unique saved label before minting a replacement.
        for (const token of await this.ports.tokens())
          if (token.label === pending.label) await this.ports.revoke(token.id)
        const issued = await this.ports.issue(pending.resolved, pending.label)
        active()
        const reference = await this.ports.retain(issued.token)
        pending.issued = { id: issued.id, reference, records: [] }
        this.save(state)
      }
      const token = this.ports.load(pending.issued.reference)
      if (!token) throw new Error('Device scope key requires recovery')
      const records = await this.ports.install(token)
      pending.issued.records = records
      this.save(state)
      active()
      state.current = pending.issued
      delete state.pending
      this.save(state)
      await this.ports.activate(records)
      console.debug('[Abele Sync] device scoped key installed', state.current.id)
    })
  }
  initialize(selection: ShareItem[]): void {
    if (!this.snapshot()) this.save({ selection: checkedDeviceScope(selection), cleanup: [] })
  }
  halt(): Promise<void> {
    return this.serialize(() => this.ports.stop())
  }
  remove(): Promise<void> {
    return this.serialize(async () => {
      const state = this.snapshot()
      if (!state) return
      await this.ports.stop()
      if (state.current) {
        state.cleanup.push(state.current)
        delete state.current
      }
      if (state.pending?.issued) state.cleanup.push(state.pending.issued)
      else if (state.pending)
        for (const token of await this.ports.tokens())
          if (token.label === state.pending.label) await this.ports.revoke(token.id)
      delete state.pending
      this.save(state)
      await this.clean(state)
      this.save(null)
    })
  }
}
