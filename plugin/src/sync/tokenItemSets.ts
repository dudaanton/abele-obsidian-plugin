import { shallowReactive, triggerRef } from 'vue'
import { encodeAccessToken, type V2AccessToken } from '@abele/sync-sdk/protocol'
import {
  ConnectionSets,
  assertItemSet,
  itemUploader,
  type SetItem,
  type ConnectionSet,
  type StoredSetItem,
} from './connectionSets'
import { V2Client, decodeAccessToken, type ScopeItem } from './v2/client'
import type { TokenUi } from './tokenUi'
import type { DeviceTokenSecrets, TokenConnectionRecord } from './tokenConnectionRegistry'
import {
  shareSetSource,
  itemLabel,
  type ShareSetSource,
  type ShareItem,
  type ConnectionItem,
  type IssuedShare,
  type ShareDeleteFacts,
} from './shareSets'

const toItem = (item: ScopeItem): SetItem => ({
  id: item.id,
  scopeId: item.scope_id,
  kind: item.scope.kind,
  path: item.scope.path,
})
const visible = (item: ScopeItem) => item.removed_at === null
const shareKind = (kind: SetItem['kind'], path: string): ShareItem['kind'] =>
  kind === 'folder' && path === '/' ? 'vault' : kind

/** Device grouping and the real server source used by the approved share screens. */
export class TokenItemSets implements ShareSetSource {
  readonly store: ConnectionSets
  private readonly capabilities = new Map<string, boolean>()
  private readonly pending = new Map<string, Promise<boolean>>()
  private readonly choiceCache = shallowReactive(new Map<string, ShareItem[]>())
  private readonly issued = new Map<string, { connectionId: string; share: IssuedShare }>()
  private readonly facts = shallowReactive(new Map<string, ShareDeleteFacts>())
  private readonly factsPending = new Set<string>()
  private installed = false
  private epoch = 0
  /** The runtime host supplies guarded local-copy operations, never a server delete. */
  removeLocal: (recordId: string) => Promise<void> = async () => {
    throw new Error('Local file host is unavailable')
  }
  copyCounts: (recordId: string) => Promise<{ files: number; edited: number; kept?: number }> =
    async () => ({
      files: 0,
      edited: 0,
    })
  private readonly counts = new Map<string, { files: number; edited: number; kept?: number }>()
  private readonly departed = new Map<string, ConnectionItem[]>()
  private readonly uploadBindings = new Map<
    string,
    { connection: ConnectionSet; item: StoredSetItem }
  >()
  private refreshUploadBindings(): void {
    this.uploadBindings.clear()
    for (const connection of this.store.all())
      for (const item of connection.items)
        if (item.recordId) this.uploadBindings.set(item.recordId, { connection, item })
  }
  mayUpload(
    recordId: string,
    path: string,
    covers: (recordId: string, path: string) => boolean
  ): boolean {
    const binding = this.uploadBindings.get(recordId)
    if (!binding) return true
    return (
      itemUploader(binding.connection.items, path, (itemId, candidate) => {
        const item = binding.connection.items.find((one) => one.id === itemId)
        return !!item?.recordId && covers(item.recordId, candidate)
      }) === binding.item.id
    )
  }
  retainedChanged(recordId: string, items: ConnectionItem[]): void {
    if (JSON.stringify(this.departed.get(recordId) ?? []) === JSON.stringify(items)) return
    this.departed.set(recordId, items)
    this.changed()
  }
  constructor(
    private readonly ui: TokenUi,
    private readonly secrets: DeviceTokenSecrets & { remove(reference: string): void },
    private readonly transport: typeof fetch
  ) {
    this.store = new ConnectionSets(ui.registry.localStorage)
    this.refreshUploadBindings()
  }
  install(): void {
    this.epoch++
    this.installed = true
    shareSetSource.value = this
  }
  uninstall(): void {
    this.epoch++
    if (shareSetSource.value === this) shareSetSource.value = null
    this.installed = false
  }
  private changed(): void {
    if (this.installed) triggerRef(shareSetSource)
    this.ui.refresh()
  }
  private selected(id?: string): string {
    const selected = id ?? this.ui.rows.value[0]?.id
    if (!selected) throw new Error('Connect to a server first')
    return selected
  }
  encoded(record: TokenConnectionRecord): string {
    if (!record.scope) throw new Error('Connection needs its token')
    const key = this.secrets.get(record.secretReference)
    if (!key) throw new Error('Connection needs its token')
    const binding = this.store.forRecord(record.id)
    return encodeAccessToken(
      binding
        ? {
            v: 2,
            address: record.address,
            key,
            items: [
              {
                id: binding.item.id,
                kind: record.scope.kind,
                scope_id: binding.item.scopeId,
                path: record.scope.path,
              },
            ],
          }
        : record.scope.kind === 'file'
          ? {
              v: 2,
              address: record.address,
              key,
              items: [
                {
                  id: 'primary:' + record.tokenId,
                  kind: 'file',
                  scope_id: record.scope.id,
                  path: record.scope.path,
                },
              ],
            }
          : {
              v: 1,
              address: record.address,
              key,
              scope: { ...record.scope, kind: record.scope.kind },
            }
    )
  }
  client(id: string): V2Client {
    const connection = this.store.get(id)
    const selected =
      connection?.items.find((item) => !item.detached && item.recordId)?.recordId ?? id
    const record = this.ui.registry.records().find((one) => one.id === selected)
    if (!record) throw new Error('Connection is unavailable')
    return new V2Client(
      decodeAccessToken(this.encoded(record)),
      this.transport,
      this.store.forRecord(selected)?.item.id
    )
  }
  several = (id?: string): boolean => {
    const selected = id ?? this.ui.rows.value[0]?.id
    return !!selected && this.capabilities.get(selected) === true
  }
  label = (id: string): string | null => this.store.get(id)?.label ?? null
  owner = (id: string): boolean => {
    const record = this.ui.registry.records().find((one) => one.id === id)
    return record?.scope?.kind === 'folder' && record.scope.path === '/'
  }
  items = (id: string): ConnectionItem[] | null => {
    const connection = this.store.get(id)
    if (!connection) {
      const departed = this.departed.get(id) ?? []
      const record = this.ui.registry.records().find((one) => one.id === id)
      if (!departed.length || !record?.scope) return null
      return [
        {
          id: 'scope:' + id,
          kind: record.scope.kind,
          path: record.localRoot ?? record.scope.path,
          state: record.paused ? { kind: 'paused' } : { kind: 'synced' },
        },
        ...departed,
      ]
    }
    return [
      ...connection.items.map<ConnectionItem>((item) => {
        const row = this.ui.registry.records().find((one) => one.id === item.recordId)
        const error = item.recordId && this.ui.activity.value[item.recordId]?.error
        return {
          id: item.id,
          kind: shareKind(item.kind, item.path),
          path: row?.localRoot ?? item.path,
          ...this.counts.get(item.id),
          state: item.detached
            ? { kind: 'detached' }
            : item.paused
              ? { kind: 'paused' }
              : row?.rootIssue?.kind === 'server-renamed'
                ? { kind: 'moved', to: row.rootIssue.to }
                : error
                  ? { kind: 'error', reason: error }
                  : row?.status === 'syncing' || row?.status === 'joining'
                    ? { kind: 'syncing', completed: 0, total: 0 }
                    : { kind: 'synced' },
        }
      }),
      ...connection.items.flatMap((item) => this.departed.get(item.recordId) ?? []),
    ]
  }
  choices = (id?: string): ShareItem[] => this.choiceCache.get(this.selected(id)) ?? []
  preview = (text: string) => {
    try {
      const token = decodeAccessToken(text)
      return token.v === 2
        ? {
            items: token.items.map((one) => ({
              id: one.id,
              kind: shareKind(one.kind, one.path),
              path: one.path,
            })),
            readOnly: false,
          }
        : null
    } catch {
      return null
    }
  }
  async resolvePreview(text: string, signal: AbortSignal) {
    const token = decodeAccessToken(text)
    const fetcher: typeof fetch = (input, init) => this.transport(input, { ...init, signal })
    const inventory = await new V2Client(token, fetcher).itemClient().items()
    const current = inventory.items.filter(visible)
    const authority = current.length
      ? await new V2Client(token, fetcher, current[0].id).connection(signal)
      : null
    return {
      items: current.map((one) => ({
        id: one.id,
        kind: shareKind(one.scope.kind, one.scope.path),
        path: one.scope.path,
      })),
      readOnly: authority?.read_only ?? false,
    }
  }
  async enroll(token: V2AccessToken, signal?: AbortSignal): Promise<string> {
    const fetcher: typeof fetch = (input, init) => this.transport(input, { ...init, signal })
    const inventory = await new V2Client(token, fetcher).itemClient().items()
    const items = inventory.items.filter(visible)
    if (!items.length) throw new Error('This key currently shares no items. Local files are kept.')
    const authorities: Awaited<ReturnType<V2Client['connection']>>[] = []
    for (const item of items) {
      if (signal?.aborted) throw new Error('Connection cancelled')
      await this.ui.connectionChangeGuard(
        undefined,
        () => {
          if (signal?.aborted) throw new Error('Connection cancelled')
        },
        item.scope
      )
      const authority = await new V2Client(token, fetcher, item.id).connection(signal)
      if (authority.scope.kind !== item.scope.kind || authority.scope.id !== item.scope.id)
        throw new Error('Share item identity changed')
      authorities.push(authority)
    }
    const existing = this.ui.registry
      .records()
      .find(
        (one) =>
          one.address === token.address &&
          one.tokenId === authorities[0].token_id &&
          one.spaceId === authorities[0].space_id
      )
    if (existing && this.store.forRecord(existing.id)) {
      const connectionId = this.store.forRecord(existing.id).connection.id
      await this.refresh(connectionId)
      return connectionId
    }
    let leader = existing?.id
    const records: string[] = []
    const provisional: string[] = []
    try {
      for (let index = 0; index < items.length; index++) {
        if (signal?.aborted) throw new Error('Connection cancelled')
        const item = items[index],
          authority = authorities[index]
        if (
          authority.token_id !== authorities[0].token_id ||
          authority.space_id !== authorities[0].space_id
        )
          throw new Error('Share authority changed')
        const id = index === 0 && existing ? existing.id : this.ui.registry.add(true)
        if (id !== existing?.id) provisional.push(id)
        this.ui.registry.attach(
          id,
          { v: 1, address: token.address, key: token.key, scope: item.scope },
          authority,
          this.secrets
        )
        records.push(id)
        leader ??= id
      }
      this.store.create(
        leader,
        '',
        items.map(toItem),
        Object.fromEntries(items.map((item, index) => [item.id, records[index]]))
      )
      if (existing)
        for (const id of records) {
          this.ui.registry.setSelective(id, existing.selective)
          if (existing.trusted) this.ui.registry.setTrusted(id, true)
        }
    } catch (error) {
      for (const id of provisional) this.ui.registry.beginForget(id)
      this.ui.registry.finishForgotten(this.secrets)
      throw error
    }
    this.capabilities.set(leader, true)
    this.changed()
    return leader
  }
  async refresh(id: string): Promise<boolean> {
    const pending = this.pending.get(id)
    if (pending !== undefined) return pending
    const work = this.refreshNow(id).finally(() => this.pending.delete(id))
    this.pending.set(id, work)
    return work
  }
  private async refreshNow(id: string): Promise<boolean> {
    const epoch = this.epoch
    const record = this.ui.registry.records().find((one) => one.id === id)
    if (!record?.scope || !record.secretReference) return false
    const client = new V2Client(
      decodeAccessToken(this.encoded(record)),
      this.transport
    ).itemClient()
    let inventory
    try {
      inventory = await client.items()
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        this.capabilities.set(id, false)
        this.changed()
        return false
      }
      throw error
    }
    const currentRecord = () =>
      epoch === this.epoch &&
      this.ui.registry
        .records()
        .some(
          (one) =>
            one.id === id &&
            one.ledgerId === record.ledgerId &&
            one.secretReference === record.secretReference
        )
    if (!currentRecord()) return false
    this.capabilities.set(id, true)
    const current = inventory.items.filter(visible)
    let connection = this.store.get(id)
    if (!connection) {
      const primary = current.find(
        (one) => one.scope.kind === record.scope.kind && one.scope.id === record.scope.id
      )
      if (!primary) return false
      this.store.create(id, '', current.map(toItem), { [primary.id]: id })
      connection = this.store.get(id)
    }
    const changes = this.store.reconcile(id, current.map(toItem))
    if (this.store.get(id).items.some((item) => item.recordId === id && item.detached))
      this.ui.publish(id, { error: undefined, startup: undefined })
    let changed = changes.added.length > 0 || changes.detached.length > 0
    for (const item of this.store.get(id).items) {
      if (item.detached) {
        if (item.recordId && (changes.detached.includes(item.id) || !this.counts.has(item.id))) {
          await this.ui.stopRuntime(item.recordId)
          this.ui.registry.setPaused(item.recordId, true)
          this.counts.set(item.id, await this.copyCounts(item.recordId))
        }
        continue
      }
      if (!item.recordId) {
        const scope = current.find((one) => one.id === item.id).scope
        await this.ui.connectionChangeGuard(undefined, undefined, scope)
        const authority = await new V2Client(
          decodeAccessToken(this.encoded(record)),
          this.transport,
          item.id
        ).connection()
        if (!currentRecord()) return false
        const added = this.ui.registry.add(true)
        try {
          this.ui.registry.attach(
            added,
            { v: 1, address: record.address, key: this.secrets.get(record.secretReference), scope },
            authority,
            this.secrets
          )
          this.store.bind(id, item.id, added)
        } catch (error) {
          this.ui.registry.beginForget(added)
          this.ui.registry.finishForgotten(this.secrets)
          throw error
        }
        this.ui.registry.setPaused(added, item.paused)
        this.ui.registry.setSelective(added, record.selective)
        if (record.trusted) this.ui.registry.setTrusted(added, true)
        changed = true
      } else if (changes.added.includes(item.id)) {
        await this.ui.disconnectRuntime(item.recordId)
        const authority = await new V2Client(
          decodeAccessToken(this.encoded(record)),
          this.transport,
          item.id
        ).connection()
        const prior = this.ui.registry.records().find((one) => one.id === item.recordId)
        if (
          !currentRecord() ||
          prior?.scope?.id !== authority.scope.id ||
          prior.scope.kind !== authority.scope.kind
        )
          throw new Error('Share item identity changed')
        this.ui.registry.setPaused(item.recordId, item.paused)
        this.ui.registry.setStatus(
          item.recordId,
          authority.status === 'active' ? (item.paused ? 'paused' : 'idle') : authority.status
        )
      }
    }
    for (const item of changes.added)
      this.ui.recordEvent(
        id,
        'Added: ' + this.store.get(id).items.find((one) => one.id === item).path
      )
    for (const item of changes.detached)
      this.ui.recordEvent(
        id,
        'No longer shared — copy kept: ' +
          this.store.get(id).items.find((one) => one.id === item).path
      )
    this.changed()
    return changed
  }
  async refreshAll(): Promise<boolean> {
    let changed = false
    const leaders = this.ui.registry
      .records()
      .filter((one) => !this.store.forRecord(one.id) || this.store.get(one.id))
    for (const row of leaders) {
      if (!row.secretReference || (row.status === 'needs-token' && !this.store.get(row.id)))
        continue
      try {
        changed = (await this.refresh(row.id)) || changed
      } catch (error) {
        console.debug('[Abele Sync items]', row.id, error)
      }
    }
    return changed
  }
  prune(): void {
    const records = this.ui.registry.records()
    for (const connection of this.store.all()) {
      if (
        !connection.items.some(
          (item) => item.recordId && records.some((record) => record.id === item.recordId)
        )
      )
        this.store.forget(connection.id)
      else if (!records.some((record) => record.id === connection.id)) {
        const next = this.store.recoverLeader(
          connection.id,
          new Set(records.map((record) => record.id))
        )
        for (const item of this.store.get(next).items)
          if (item.recordId) this.ui.registry.setPaused(item.recordId, true)
      }
    }
    for (const id of this.capabilities.keys())
      if (!records.some((record) => record.id === id)) {
        this.capabilities.delete(id)
        this.choiceCache.delete(id)
        this.departed.delete(id)
      }
    for (const [id, entry] of this.issued)
      if (!records.some((record) => record.id === entry.connectionId)) this.issued.delete(id)
    this.refreshUploadBindings()
  }
  async pauseItem(id: string, itemId: string, paused: boolean): Promise<void> {
    if (itemId === 'scope:' + id) {
      await this.ui.pause(id, paused)
      return
    }
    const item = this.store.get(id)?.items.find((one) => one.id === itemId)
    if (!item?.recordId || item.detached) throw new Error('Item is no longer shared')
    this.store.pause(id, itemId, paused)
    this.ui.registry.setPaused(item.recordId, paused)
    await this.ui.runtimes.get(item.recordId)?.pause(paused)
    this.changed()
  }
  async followItem(id: string, itemId: string): Promise<void> {
    const item = this.store.get(id)?.items.find((one) => one.id === itemId)
    const runtime = this.ui.runtimes.get(item?.recordId ?? id)
    if (!runtime?.followServerRoot) throw new Error('Item is unavailable')
    await runtime.followServerRoot()
  }
  async removeCopy(id: string, itemId: string): Promise<void> {
    if (itemId.startsWith('retained:')) {
      const recordId =
        this.store
          .get(id)
          ?.items.find((item) => this.departed.get(item.recordId)?.some((one) => one.id === itemId))
          ?.recordId ?? id
      const runtime = this.ui.runtimes.get(recordId)
      if (!runtime?.removeRetainedCopy) throw new Error('Local file host is unavailable')
      await runtime.removeRetainedCopy(itemId)
      return
    }
    const item = this.store.get(id)?.items.find((one) => one.id === itemId)
    if (!item?.detached || !item.recordId) throw new Error('Only a detached copy may be removed')
    await this.removeLocal(item.recordId)
    this.counts.set(item.id, await this.copyCounts(item.recordId))
    this.changed()
  }
  async shares(id?: string): Promise<IssuedShare[]> {
    const connectionId = this.selected(id),
      client = this.client(connectionId)
    const scopes = await this.ui.choices(connectionId)
    this.choiceCache.set(
      connectionId,
      scopes
        .filter(
          (scope, index) =>
            scopes.findIndex((other) => other.kind === scope.kind && other.path === scope.path) ===
            index
        )
        .map((scope) => ({
          kind: scope.kind === 'folder' && scope.path === '/' ? 'vault' : scope.kind,
          id: scope.id,
          path: scope.path,
        }))
    )
    this.changed()
    const tokens = (await client.tokens()).items
    const shares: IssuedShare[] = []
    for (const token of tokens) {
      const items = (await client.ownedItems(token.id)).items.filter(visible)
      const share: IssuedShare = {
        id: token.id,
        label: token.label,
        readOnly: token.read_only ?? false,
        createdAt: token.created_at,
        revokedAt: token.revoked_at,
        items: items.map((one) => ({
          id: one.id,
          kind: shareKind(one.scope.kind, one.scope.path),
          path: one.scope.path,
        })),
      }
      this.issued.set(token.id, { connectionId, share })
      shares.push(share)
    }
    return shares
  }
  async issue(
    id: string | undefined,
    set: { items: ShareItem[]; label: string; readOnly: boolean }
  ): Promise<string> {
    const connectionId = this.selected(id),
      client = this.client(connectionId)
    if (!this.several(connectionId)) throw new Error('This server supports one item per key')
    assertItemSet(
      set.items.map((one) => ({
        ...one,
        kind: one.kind === 'vault' ? 'folder' : one.kind,
        scopeId: one.id,
      }))
    )
    if (!set.items.length) throw new Error('Choose something to share')
    const selector = (item: ShareItem) => ({
      kind: item.kind === 'vault' ? ('folder' as const) : item.kind,
      id: item.id,
    })
    const issued = await client.issue({
      scope: selector(set.items[0]),
      label: set.label,
      read_only: set.readOnly,
    })
    for (const item of set.items.slice(1))
      await client.itemClient().addItem(issued.info.id, selector(item))
    this.ui.releaseLocalOnly(
      connectionId,
      set.items.map((one) => one.path)
    )
    const token = decodeAccessToken(issued.token)
    const inventory = await new V2Client(decodeAccessToken(issued.token), this.transport)
      .itemClient()
      .items()
    return encodeAccessToken({
      v: 2,
      address: token.address,
      key: token.key,
      items: inventory.items.filter(visible).map((one) => ({
        id: one.id,
        kind: one.scope.kind,
        scope_id: one.scope_id,
        path: one.scope.path,
      })),
    })
  }
  async add(id: string | undefined, shareId: string, items: ShareItem[]): Promise<void> {
    const current = this.issued.get(shareId)?.share.items ?? []
    assertItemSet(
      [...current, ...items].map((one) => ({
        id: one.id,
        kind: one.kind === 'vault' ? 'folder' : one.kind,
        scopeId: one.id,
        path: one.path,
      }))
    )
    const client = this.client(this.selected(id)).itemClient()
    for (const item of items)
      await client.addItem(shareId, {
        kind: item.kind === 'vault' ? 'folder' : item.kind,
        id: item.id,
      })
    this.ui.releaseLocalOnly(
      this.selected(id),
      items.map((one) => one.path)
    )
    this.facts.clear()
  }
  async remove(id: string | undefined, shareId: string, itemId: string): Promise<void> {
    await this.client(this.selected(id)).itemClient().removeItem(shareId, itemId)
    this.facts.clear()
  }
  async revoke(id: string | undefined, shareId: string): Promise<void> {
    await this.client(this.selected(id)).revoke(shareId)
  }
  deleteFacts = (shareId: string, itemId: string | null): ShareDeleteFacts | null => {
    const key = shareId + ':' + (itemId ?? '*')
    if (!this.facts.has(key) && !this.factsPending.has(key)) {
      this.factsPending.add(key)
      void this.loadDeleteFacts(shareId, itemId)
        .then((facts) => {
          this.facts.set(key, facts)
          this.changed()
        })
        .catch((error) => {
          console.debug('[Abele Sync item delete facts]', error)
          this.facts.set(key, {
            files: 0,
            bytes: 0,
            access: [],
            canWrite: false,
            unavailableReason:
              (error as { code?: string })?.code === 'forbidden' ||
              (error as { status?: number })?.status === 403
                ? 'This connection does not allow that action.'
                : 'Could not read the files this would delete. Try again.',
          })
          this.changed()
        })
        .finally(() => this.factsPending.delete(key))
    }
    return this.facts.get(key) ?? null
  }
  closeDeletePreview(shareId: string): void {
    for (const key of this.facts.keys()) if (key.startsWith(shareId + ':')) this.facts.delete(key)
  }
  private async loadDeleteFacts(shareId: string, itemId: string | null): Promise<ShareDeleteFacts> {
    const issued = this.issued.get(shareId)
    if (!issued) throw new Error('Share is unavailable')
    const client = this.client(issued.connectionId)
    const preview =
      itemId === null
        ? await client.previewToken(shareId)
        : await client.previewTokenItem(shareId, itemId)
    const items =
      'items' in preview ? preview.items.filter((item) => item.removed_at === null) : [preview]
    const also = new Map<string, { path: string; group?: string; overlapCount?: number }>()
    const affected = new Map<string, { label: string; scope: string }>()
    const tokens = (await client.tokens()).items
    const deletedFiles = new Set(items.flatMap((item) => item.files.map((file) => file.file_id)))
    const losesScope = (scope: ScopeItem['scope']) =>
      items.some(
        (item) =>
          scope.id === item.scope.id ||
          (scope.kind !== 'folder' && deletedFiles.has(scope.id)) ||
          (item.scope.kind === 'folder' &&
            (item.scope.path === '/' || scope.path.startsWith(item.scope.path + '/')))
      )
    for (const token of tokens.filter((one) => !one.revoked_at)) {
      const scopes =
        token.id === shareId
          ? items.map((item) => item.scope)
          : (await client.ownedItems(token.id)).items.filter(visible).map((item) => item.scope)
      const losses = [
        ...new Set(
          scopes.filter(losesScope).map(
            (scope) =>
              'Loses ' +
              itemLabel({
                id: scope.id,
                kind: shareKind(scope.kind, scope.path),
                path: scope.path,
              })
          )
        ),
      ]
      if (losses.length)
        affected.set(token.id, {
          label: token.label || issued.share.label,
          scope: losses.join(' · '),
        })
    }
    let alsoMore = false
    for (const item of items) {
      if (item.scope.kind === 'group' && item.files.length < item.file_count) alsoMore = true
      for (const file of item.files) {
        const undisclosed = file.overlap_count - file.overlaps.length
        for (const overlap of file.overlaps) {
          if (overlap.scope.kind === 'group') {
            const group = overlap.scope.path.split('/').pop().replace(/\.md$/i, '')
            also.set(file.file_id + ':' + overlap.scope_id, { path: file.path, group })
          }
        }
        if (undisclosed > 0)
          also.set(file.file_id + ':undisclosed', { path: file.path, overlapCount: undisclosed })
      }
    }
    return {
      files: preview.file_count,
      bytes: preview.total_bytes,
      access: [...affected.values()],
      also: [...also.values()],
      alsoMore,
      canWrite:
        items.every((item) => item.status === 'active') && !(await client.connection()).read_only,
    }
  }

  private deletionWork: Promise<void> = Promise.resolve()
  deleteFromServer(shareId: string, itemId: string | null): Promise<void> {
    const work = this.deletionWork.then(() => this.performItemDeletion(shareId, itemId))
    this.deletionWork = work.catch(() => {})
    return work
  }
  private async performItemDeletion(shareId: string, itemId: string | null): Promise<void> {
    const issued = this.issued.get(shareId)
    if (!issued) throw new Error('Only the issuer may delete this share from the server')
    const facts = this.deleteFacts(shareId, itemId)
    if (!facts?.canWrite) throw new Error('Deletion inventory is unavailable')
    const client = this.client(issued.connectionId)
    const items = (await client.ownedItems(shareId)).items
      .filter(visible)
      .filter((one) => itemId === null || one.id === itemId)
    const preview =
      itemId === null
        ? await client.previewToken(shareId)
        : await client.previewTokenItem(shareId, itemId)
    const previews = 'items' in preview ? preview.items.filter(visible) : [preview]
    const complete = previews.every(
      (one) => one.scope.kind !== 'group' || one.files.length === one.file_count
    )
    const affected = complete
      ? previews.flatMap((one) =>
          one.scope.kind === 'group'
            ? [one.scope.path, ...one.files.map((file) => file.path)]
            : [one.scope.path]
        )
      : undefined
    const resume = await this.ui.protectLocalFilesForItemDeletion(issued.connectionId, [], affected)
    let completed = false
    try {
      const local = this.ui.registry.localStorage
      for (const item of items) {
        const key = 'abele-sync-item-delete:' + shareId + ':' + item.id
        const saved = local.loadLocalStorage(key)
        const requestId = typeof saved === 'string' ? saved : crypto.randomUUID()
        local.saveLocalStorage(key, requestId)
        if (local.loadLocalStorage(key) !== requestId)
          throw new Error('Could not retain deletion retry identity')
        await client.itemClient().deleteItem(item.id, requestId)
      }
      if (itemId === null) await client.revoke(shareId)
      completed = true
    } finally {
      await resume(completed)
    }
  }
}
