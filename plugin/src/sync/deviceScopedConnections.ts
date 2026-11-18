import type { TokenUi } from './tokenUi'
import type { DeviceTokenSecrets } from './tokenConnectionRegistry'
import { DeviceScopeLease, DEVICE_SCOPE_LEASE } from './deviceScopeLease'
import {
  checkedDeviceScope,
  deviceScopeMatcher,
  readDeviceScope,
  writeDeviceScope,
} from './deviceScope'
import type { ShareItem } from './shareSets'
import type { ConnectionSet } from './connectionSets'
import type { scopeInventory } from './deviceScopeInventory'
import { V2Client, decodeAccessToken } from './v2/client'
import { DEVICE_SECRET_PREFIX } from '@/secrets/deviceSecret'

export const SCOPE_SOURCE = 'abele-sync-token-state:scope-source'
export const SCOPE_OWNED_BY = 'abele-sync-token-state:scope-owned-by'
export const SCOPE_BOOTSTRAP = 'abele-sync-token-state:scope-bootstrap'
const SOURCE_SET = 'abele-sync-token-state:scope-original-set'
export const SCOPE_STOPPED = 'abele-sync-token-state:scope-stopped'
const SCOPE_PAUSES = 'abele-sync-token-state:scope-pauses'

/** Scoped keys use the ordinary Share machinery; source credentials are management only. */
export class DeviceScopedConnections {
  private readonly preparations = new Map<string, (path: string) => void>()
  applied(id: string, change: import('@abele/sync-sdk/core').AppliedChange): void {
    if (change.origin === 'local' && change.kind === 'upsert')
      this.preparations.get(id)?.(change.path)
  }
  private readonly leases = new Map<string, DeviceScopeLease>()
  constructor(
    private readonly ui: TokenUi,
    private readonly secrets: DeviceTokenSecrets & { remove(reference: string): void },
    private readonly transport: typeof fetch
  ) {}
  state(id: string) {
    return this.lease(id).snapshot()
  }
  halt(id: string): Promise<void> {
    return this.lease(id).halt()
  }
  private pauseFor(parent: string, scope: { kind: string; id: string }): boolean {
    const saved = this.ui.registry.storage(parent).loadLocalStorage(SCOPE_PAUSES) as Record<
      string,
      boolean
    > | null
    return this.source(parent).paused || saved?.[scope.kind + ':' + scope.id] === true
  }
  private source(id: string) {
    const record = this.ui.registry.records().find((one) => one.id === id)
    if (!record?.scope) throw new Error('Connection is unavailable')
    return record
  }
  managementClient(id: string) {
    const record = this.source(id)
    const owner = typeof record.state[SCOPE_SOURCE] === 'string' ? record.state[SCOPE_SOURCE] : id
    const saved = this.ui.registry
      .storage(owner)
      .loadLocalStorage(SOURCE_SET) as ConnectionSet | null
    const primary = saved?.items.find((item) => item.recordId === id)
    return new V2Client(
      decodeAccessToken(this.ui.itemSets.encoded(record)),
      this.transport,
      primary?.id
    )
  }
  visible(id: string): boolean {
    const record = this.ui.registry.records().find((one) => one.id === id)
    return (
      !record.state[SCOPE_OWNED_BY] &&
      !record.state[SCOPE_BOOTSTRAP] &&
      (!record.state[SCOPE_SOURCE] || record.state[SCOPE_SOURCE] === id)
    )
  }
  runnable(id: string): boolean {
    const record = this.ui.registry.records().find((one) => one.id === id)
    if (
      record.state[SCOPE_SOURCE] ||
      record.state[DEVICE_SCOPE_LEASE] ||
      record.state[SCOPE_STOPPED]
    )
      return false
    const parent = record.state[SCOPE_OWNED_BY]
    const owner = parent ?? record.state[SCOPE_BOOTSTRAP]
    if (
      typeof owner === 'string' &&
      this.ui.registry.records().find((one) => one.id === owner)?.state[SCOPE_STOPPED]
    )
      return false
    if (typeof parent !== 'string') return true
    if (this.source(parent).paused) return false
    const state = this.state(parent)
    return !!state?.current?.records.includes(id) && !state.pending && !state.cleanup.length
  }
  private async forget(records: string[]) {
    for (const id of records) {
      if (!this.ui.registry.records().some((one) => one.id === id)) continue
      await this.ui.prepareDisconnect(id)
      await this.ui.disconnectRuntime(id)
      this.ui.registry.beginForget(id)
      await this.ui.registry.finishForgottenDurably(this.secrets, id)
    }
    this.ui.refresh()
  }
  initialize(id: string, items: ShareItem[]) {
    const storage = this.ui.registry.storage(id)
    if (!this.state(id)) {
      storage.saveLocalStorage(SOURCE_SET, this.ui.itemSets.store.get(id))
      for (const recordId of this.sourceRecords(id))
        this.ui.registry.storage(recordId).saveLocalStorage(SCOPE_SOURCE, id)
      this.lease(id).initialize(items)
    }
    writeDeviceScope(storage, items)
  }
  private sourceRecords(id: string): string[] {
    const saved = (this.ui.registry.storage(id).loadLocalStorage(SOURCE_SET) ??
      (this.state(id) ? null : this.ui.itemSets.store.get(id))) as ConnectionSet | null
    return [
      ...new Set([
        id,
        ...(saved?.items.flatMap((item) => (item.recordId ? [item.recordId] : [])) ?? []),
      ]),
    ]
  }
  captureSourceSet(id: string): void {
    const local = this.ui.registry.storage(id)
    if (local.loadLocalStorage(SOURCE_SET) == null)
      local.saveLocalStorage(SOURCE_SET, this.ui.itemSets.store.get(id))
  }
  private lease(id: string): DeviceScopeLease {
    const cached = this.leases.get(id)
    if (cached) return cached
    const lease = new DeviceScopeLease(this.ui.registry.storage(id), {
      stop: async () => {
        const records = this.ui.registry
          .records()
          .filter(
            (one) =>
              one.id === id ||
              one.state[SCOPE_SOURCE] === id ||
              one.state[SCOPE_OWNED_BY] === id ||
              one.state[SCOPE_BOOTSTRAP] === id
          )
        for (const record of records) {
          if (record.state[SCOPE_OWNED_BY]) this.ui.registry.setPaused(record.id, true)
          await this.ui.prepareDisconnect(record.id)
          await this.ui.disconnectRuntime(record.id)
        }
        await this.ui.registry.flush()
      },
      resolve: (items) => this.resolve(id, items, undefined, false),
      tokens: async () => (await this.managementClient(id).tokens()).items,
      issue: async (items, label) => {
        const client = this.managementClient(id)
        const authority = await client.connection()
        const result = await client.issue({
          scope: { kind: items[0].kind === 'vault' ? 'folder' : items[0].kind, id: items[0].id },
          label,
          read_only: authority.read_only ?? false,
        })
        for (const item of items.slice(1))
          await client.itemClient().addItem(result.info.id, {
            kind: item.kind === 'vault' ? 'folder' : item.kind,
            id: item.id,
          })
        return { id: result.info.id, token: result.token }
      },
      retain: async (token) => {
        const reference = DEVICE_SECRET_PREFIX + 'scope-' + crypto.randomUUID()
        this.secrets.set(reference, token)
        await this.secrets.flush?.()
        return reference
      },
      load: (reference) => this.secrets.get(reference),
      drop: async (reference) => {
        this.secrets.remove(reference)
        await this.secrets.flush?.()
      },
      install: async (token) => {
        const leader = await this.ui.itemSets.enroll(decodeAccessToken(token))
        const set = this.ui.itemSets.store.get(leader)
        if (!set) throw new Error('Scoped connection enrollment is incomplete')
        const records = set.items.flatMap((item) => (item.recordId ? [item.recordId] : []))
        for (const recordId of records) {
          this.ui.registry.storage(recordId).saveLocalStorage(SCOPE_OWNED_BY, id)
          const child = this.source(recordId)
          const original = this.sourceRecords(id)
            .map((sourceId) => this.source(sourceId))
            .find(
              (source) =>
                source.scope.kind === 'folder' &&
                child.scope.kind === 'folder' &&
                (source.scope.id === child.scope.id ||
                  [source.serverRoot ?? source.scope.path, source.scope.path].some(
                    (root) => root === '/' || child.scope.path.startsWith(root + '/')
                  ))
            )
          if (original) this.ui.registry.inheritScopePlacement(recordId, original.id)
          this.ui.registry.setPaused(recordId, true)
          const membership = set.items.find((item) => item.recordId === recordId)
          this.ui.itemSets.store.pause(leader, membership.id, this.pauseFor(id, child.scope))
          this.ui.registry.setSelective(recordId, this.source(id).selective)
          if (this.source(id).trusted) this.ui.registry.setTrusted(recordId, true)
        }
        this.ui.itemSets.store.reparent(leader, id)
        this.ui.itemSets.enableItems(id)
        await this.ui.registry.flush()
        return records
      },
      activate: async (records) => {
        for (const recordId of records) {
          const item = this.ui.itemSets.store
            .get(id)
            ?.items.find((one) => one.recordId === recordId)
          if (!item) throw new Error('Scoped connection enrollment is incomplete')
          // Enrollment seeds the requested pause; later user changes live in this
          // durable item, while the registry is only its engine projection.
          const paused = this.source(id).paused || item.paused
          this.ui.registry.setPaused(recordId, paused)
        }
        await this.ui.registry.flush()
        this.ui.refresh()
        await this.ui.connectionsChanged()
      },
      forget: (records) => this.forget(records),
      revoke: async (tokenId) => {
        await this.managementClient(id).revoke(tokenId)
      },
    })
    this.leases.set(id, lease)
    return lease
  }
  private async remoteChoices(id: string) {
    const choices: Awaited<ReturnType<TokenUi['choices']>> = []
    for (const source of this.sourceRecords(id))
      choices.push(...(await this.ui.choices(source, this.managementClient(source))))
    return choices
  }
  choices(id: string, inventory: ReturnType<typeof scopeInventory>): ShareItem[] {
    const sources = this.sourceRecords(id).map((source) => this.source(source))
    const toLocal = this.mapper(id, true)
    const roots: ShareItem[] = sources.map((source) => ({
      kind: source.scope.kind,
      id: source.scope.id,
      path: toLocal(source.scope.path),
    }))
    const members = new Map(
      roots
        .filter((root) => root.kind === 'group')
        .map((root) => [root.path, new Set(inventory.members(root.path))])
    )
    const allowed = inventory.choices.filter(
      (item) =>
        item.kind !== 'vault' &&
        roots.some((root) =>
          root.kind === 'folder'
            ? item.path === root.path || item.path.startsWith(root.path + '/')
            : root.kind === 'group'
              ? item.kind !== 'folder' && members.get(root.path).has(item.path)
              : item.kind === 'file' && item.path === root.path
        )
    )
    const keys = new Set(roots.map((item) => item.kind + ':' + item.path))
    return [...roots, ...allowed.filter((item) => !keys.has(item.kind + ':' + item.path))]
  }
  private mapper(id: string, incoming: boolean): (path: string) => string {
    const records = this.sourceRecords(id)
      .map((source) => this.source(source))
      .sort((a, b) => (b.localRoot?.length ?? 0) - (a.localRoot?.length ?? 0))
    return (path) => {
      for (const record of records) {
        if (record.scope.kind !== 'folder' || record.scope.path === '/') continue
        const local = record.localRoot ?? record.scope.path
        const server = record.serverRoot ?? record.scope.path
        const roots = incoming ? [server, record.scope.path] : [local]
        for (const root of roots) {
          if (root !== '/' && path !== root && !path.startsWith(root + '/')) continue
          const suffix = root === '/' ? path : path.slice(root.length).replace(/^\//, '')
          const target = incoming ? local : server
          return suffix ? (target === '/' ? suffix : target + '/' + suffix) : target
        }
      }
      return path
    }
  }
  async resolve(
    id: string,
    items: ShareItem[],
    sending?: (sent: number, total: number) => void,
    requirePublished = true
  ): Promise<ShareItem[]> {
    let choices = await this.remoteChoices(id)
    const toServer = this.mapper(id, false),
      toLocal = this.mapper(id, true)
    const remembered = this.state(id)?.resolved ?? []
    const matches = (item: ShareItem) => {
      const wire = toServer(item.path)
      const previousId = remembered.find(
        (previous) => previous.kind === item.kind && previous.path === item.path
      )?.id
      return choices.find(
        (one) =>
          one.kind === (item.kind === 'vault' ? 'folder' : item.kind) &&
          (one.id === item.id || one.id === previousId || one.path === wire)
      )
    }
    const inventory = this.ui.scopeInventory()
    const localItems = items.map((item) => ({
      ...item,
      path: toLocal(item.path),
    }))
    const selection = deviceScopeMatcher(localItems, (item) => inventory.members(item.path))
    const localFiles = inventory.choices.filter(
      (item) => item.kind === 'file' && !selection.ignores(item.path)
    )
    const remoteFiles = new Set(
      choices.filter((item) => item.kind === 'file').map((item) => item.path)
    )
    const missingPaths = new Set(
      localFiles
        .filter((item) => !remoteFiles.has(toServer(item.path)))
        .map((item) => item.path.normalize('NFC'))
    )
    const authority = await this.managementClient(id).connection()
    if (
      authority.read_only &&
      (items.some((item) => !matches(item)) || (requirePublished && missingPaths.size))
    )
      throw new Error('This access is read only and cannot upload the selected files')
    if (!authority.read_only && (localFiles.length || items.some((item) => !matches(item)))) {
      const sent = new Set<string>()
      if (missingPaths.size) sending?.(0, missingPaths.size)
      await this.bootstrap(id, items, (path) => {
        path = toLocal(path).normalize('NFC')
        if (!missingPaths.has(path)) return
        sent.add(path)
        sending?.(sent.size, missingPaths.size)
      })
      choices = await this.remoteChoices(id)
      const published = new Set(
        choices.filter((item) => item.kind === 'file').map((item) => item.path)
      )
      const missing = localFiles.find((item) => !published.has(toServer(item.path)))
      if (missing)
        throw new Error(
          'A selected file could not be uploaded. Check sync exclusions and file limits: ' +
            missing.path
        )
    }
    if (missingPaths.size && !authority.read_only) sending?.(missingPaths.size, missingPaths.size)
    return items.map((item) => {
      const remote = matches(item)
      if (!remote) throw new Error('Selected item has not reached the server: ' + item.path)
      return { ...remote, kind: item.kind }
    })
  }
  private async bootstrap(id: string, items: ShareItem[], applied?: (path: string) => void) {
    if (this.source(id).paused || this.source(id).state[SCOPE_STOPPED])
      throw new Error('Resume this connection before uploading the selected files')
    const abandoned = this.ui.registry.records().filter((one) => one.state[SCOPE_BOOTSTRAP] === id)
    await this.forget(abandoned.map((one) => one.id))
    const original = this.ui.registry
      .storage(id)
      .loadLocalStorage(SOURCE_SET) as ConnectionSet | null
    const sources = this.sourceRecords(id).map((recordId) => this.source(recordId))
    const inventory = this.ui.scopeInventory()
    const toServer = this.mapper(id, false),
      toLocal = this.mapper(id, true)
    let covered = false
    for (const source of sources) {
      const scope = source.scope
      const selected = items
        .filter((item) => {
          const path = toServer(item.path)
          const root = source.serverRoot ?? scope.path
          return scope.kind === 'folder'
            ? root === '/' || path === root || path.startsWith(root + '/')
            : scope.kind === 'group'
              ? inventory.members(toLocal(scope.path)).includes(toLocal(item.path))
              : item.path === scope.path && item.kind === scope.kind
        })
        .map((item) => ({ ...item, path: toLocal(item.path) }))
      if (!selected.length) continue
      covered = true
      const recordId = this.ui.registry.add(true)
      if (applied) this.preparations.set(recordId, applied)
      try {
        const local = this.ui.registry.storage(recordId)
        writeDeviceScope(local, selected)
        local.saveLocalStorage(SCOPE_BOOTSTRAP, id)
        const authority = await this.managementClient(source.id).connection()
        const key = this.secrets.get(source.secretReference)
        if (!key) throw new Error('Connection needs its token')
        await this.ui.registry.attachDurably(
          recordId,
          { v: 1, address: source.address, key, scope: authority.scope },
          authority,
          this.secrets
        )
        if (source.scope.kind === 'folder')
          this.ui.registry.inheritScopePlacement(recordId, source.id)
        const sourceItem = original?.items.find((item) => item.recordId === source.id)
        if (sourceItem)
          this.ui.itemSets.store.create(recordId, '', [sourceItem], { [sourceItem.id]: recordId })
        this.ui.registry.setSelective(recordId, source.selective)
        this.ui.registry.setPaused(recordId, this.source(id).paused)
        await this.ui.registry.flush()
        await this.ui.connectionsChanged()
        await this.ui.sync(recordId)
      } finally {
        this.preparations.delete(recordId)
        await this.forget([recordId])
        this.ui.itemSets.store.forget(recordId)
      }
    }
    if (!covered) throw new Error('The selected items are outside this access')
  }
  async change(id: string, items: ShareItem[], signal?: AbortSignal) {
    items = checkedDeviceScope(items)
    const before = this.state(id)
    if (
      before?.current &&
      !before.activating &&
      !before.pending &&
      !before.cleanup.length &&
      JSON.stringify(before.selection) === JSON.stringify(items) &&
      !this.source(id).state[SCOPE_STOPPED]
    )
      return
    if (
      this.ui.registry.storage(id).loadLocalStorage(SCOPE_PAUSES) == null ||
      (before?.current && JSON.stringify(before.selection) !== JSON.stringify(items))
    )
      this.ui.registry
        .storage(id)
        .saveLocalStorage(
          SCOPE_PAUSES,
          Object.fromEntries(
            (this.ui.itemSets.store.get(id)?.items ?? []).map((item) => [
              item.kind +
                ':' +
                (this.ui.registry.records().find((record) => record.id === item.recordId)?.scope
                  ?.id ?? item.scopeId),
              item.paused,
            ])
          )
        )
    if (signal?.aborted) {
      this.ui.registry.storage(id).saveLocalStorage(SCOPE_STOPPED, true)
      await this.lease(id).halt()
      signal.throwIfAborted()
    }
    this.ui.registry.storage(id).saveLocalStorage(SCOPE_STOPPED, null)
    writeDeviceScope(this.ui.registry.storage(id), items)
    if (items.some((item) => item.kind === 'vault')) {
      if (this.state(id) || this.source(id).state[SCOPE_SOURCE]) {
        if (this.state(id)) await this.lease(id).remove()
        this.ui.itemSets.store.forget(id)
        const saved = this.ui.registry
          .storage(id)
          .loadLocalStorage(SOURCE_SET) as ConnectionSet | null
        if (saved)
          this.ui.itemSets.store.create(
            id,
            saved.label,
            saved.items,
            Object.fromEntries(
              saved.items.flatMap((item) => (item.recordId ? [[item.id, item.recordId]] : []))
            )
          )
        const parent = this.source(id)
        const restored = this.sourceRecords(id).map((recordId) => ({
          recordId,
          paused: this.pauseFor(id, this.source(recordId).scope),
        }))
        for (const { recordId, paused } of restored) {
          this.ui.registry.setPaused(recordId, paused)
          this.ui.registry.setSelective(recordId, parent.selective)
          this.ui.registry.setTrusted(recordId, parent.trusted)
          const item = this.ui.itemSets.store
            .get(id)
            ?.items.find((one) => one.recordId === recordId)
          if (item) this.ui.itemSets.store.pause(id, item.id, paused)
          this.ui.registry.storage(recordId).saveLocalStorage(SCOPE_SOURCE, null)
        }
      }
      writeDeviceScope(this.ui.registry.storage(id), items)
      await this.ui.registry.flush()
      this.ui.refresh()
      await this.ui.connectionsChanged()
      return
    }
    try {
      this.initialize(id, items)
    } catch (error) {
      await this.lease(id).halt()
      throw error
    }
    const cancel = () => {
      this.ui.registry.storage(id).saveLocalStorage(SCOPE_STOPPED, true)
      void this.pauseAuxiliary(id, true).catch((error) =>
        console.debug('[Abele Sync] scope cancellation', error)
      )
    }
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      await this.lease(id).change(items, signal)
    } catch (error) {
      if (signal?.aborted) {
        cancel()
        await this.lease(id).halt()
      }
      this.ui.publish(id, {
        error: error instanceof Error ? error.message : 'Device scope could not be prepared',
      })
      throw error
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }
  async pauseAuxiliary(id: string, paused: boolean) {
    const desired: Record<string, boolean> = {}
    for (const record of this.ui.registry.records()) {
      if (record.state[SCOPE_BOOTSTRAP] !== id && record.state[SCOPE_OWNED_BY] !== id) continue
      this.ui.registry.setPaused(record.id, paused)
      const item = this.ui.itemSets.store.get(id)?.items.find((one) => one.recordId === record.id)
      if (item) {
        this.ui.itemSets.store.pause(id, item.id, paused)
        desired[item.kind + ':' + record.scope.id] = paused
      }
      await this.ui.runtimes.get(record.id)?.pause(paused)
    }
    await this.ui.registry.flush()
    if (!this.source(id).state[SCOPE_STOPPED])
      this.ui.registry.storage(id).saveLocalStorage(SCOPE_PAUSES, desired)
    if (!paused) await this.ui.connectionsChanged()
  }
  async remove(id: string) {
    if (!this.ui.registry.records().some((record) => record.id === id)) return
    if (!this.state(id) && !this.source(id).state[SCOPE_SOURCE]) return
    this.ui.registry.storage(id).saveLocalStorage(SCOPE_STOPPED, true)
    if (this.state(id)) await this.lease(id).remove()
    await this.forget(this.sourceRecords(id).filter((recordId) => recordId !== id))
    this.ui.itemSets.store.forget(id)
    this.ui.refresh()
  }
  private resuming?: Promise<void>
  resume(): Promise<void> {
    if (this.resuming !== undefined) return this.resuming
    const work = this.resumePending().finally(() => {
      this.resuming = undefined
    })
    this.resuming = work
    return work
  }
  private async resumePending() {
    await Promise.all(
      this.ui.registry
        .records()
        .filter(
          (record) =>
            (record.state[DEVICE_SCOPE_LEASE] || record.state[SCOPE_SOURCE] === record.id) &&
            !record.state[SCOPE_STOPPED]
        )
        .map(async (record) => {
          try {
            const state = this.state(record.id)
            const desired = readDeviceScope(this.ui.registry.storage(record.id)) ?? state?.selection
            if (!desired) throw new Error('Device scope selection requires recovery')
            if (
              state?.current &&
              !state.activating &&
              !state.pending &&
              !state.cleanup.length &&
              JSON.stringify(desired) === JSON.stringify(state.selection)
            )
              return
            await this.change(record.id, desired)
          } catch (error) {
            this.ui.publish(record.id, {
              error: error instanceof Error ? error.message : 'Device scope could not be prepared',
            })
          }
        })
    )
  }
}
