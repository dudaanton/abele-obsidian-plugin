import type { App } from 'obsidian'
import { sha256 } from '@abele/sync-core'
import { markRaw, shallowRef } from 'vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { boundDeviceToken } from '@/secrets/deviceSecret'
import { secrets } from '@/secrets/SecretStore'
import type { SyncService } from './SyncService'
import { factoryOf, transportOf, type SyncServiceDeps } from './environment'
import { readLedgerId } from './ledgerId'
import { openLinkSnapshots, type SnapshotDescriptor } from './publication/snapshotDatabase'
import { NativeOwnerPublication } from './publication/nativeOwnerPublication'
import { bindingKey, type SnapshotBinding } from './publication/LinkSnapshotStore'
import { FolderSharingFlow } from './sharing/folderSharing'
import { OwnerFolderHttpPort, type OwnerSharedGrant } from './sharing/ownerHttp'
import { OwnerGroupRootFlow, type GroupRoot } from './sharing/ownerGroupRoot'
import { ScopedPluginHost } from './scoped/scopedPluginHost'
import {
  audiencesFor,
  groupsFor,
  groupHints,
  type GroupShareHint,
  DiscoveryCatalogueError,
} from './sharing/sharingCatalogue'

import {
  PUBLICATION_DESCRIPTOR as DESCRIPTOR,
  PUBLICATION_SENTINEL as SENTINEL,
  rememberPublicationStore,
  retirePublicationStores,
} from './publication/publicationRetirement'
const AUDIENCES = 'owner-publication-audiences-v1'
const hash = (value: unknown) => sha256(new TextEncoder().encode(JSON.stringify(value)))

/** Production composition of the same bound publication, owner HTTP and scoped core ports
 * used by the stand. No test build marker, fixture identity, credential substitute or parser
 * establishes authority. Every server effect still goes through the existing checked class. */
export class PluginSharing {
  readonly scoped: ScopedPluginHost
  readonly scope: ScopedPluginHost['connection']
  readonly publicationPrompt: SyncService['publicationPrompt']
  private closed = false
  private readonly ownerAvailable = shallowRef(false)
  private managementCache: { owner: object; port: OwnerFolderHttpPort } | null = null
  private live: {
    context: Parameters<NonNullable<SyncServiceDeps['ownerPublication']>>[0]
    runtime: NativeOwnerPublication
    resources: Awaited<ReturnType<typeof openLinkSnapshots>>
    binding: SnapshotBinding
    grants: string[]
    groups: GroupShareHint[]
    catalogueReadable: boolean
    settingsPending: boolean
    signedIn: boolean
    serverSnapshot: boolean
    held: () => boolean
    settling: () => boolean
    restoreTransaction: () => void
  } | null = null
  private catalogueQueue: Promise<void> = Promise.resolve()
  private linkRefreshQueued = false
  private linksDirty = false
  readonly audiences = shallowRef<string[]>([])
  readonly discoveryWarning = shallowRef('')
  constructor(
    readonly app: App,
    readonly sync: SyncService,
    private readonly deps: SyncServiceDeps
  ) {
    this.publicationPrompt = sync.publicationPrompt
    this.scoped = new ScopedPluginHost(app, transportOf(deps), factoryOf(deps), (state, error) =>
      sync.scopedStatus(state, error)
    )
    this.scope = this.scoped.connection
  }
  private token(c: {
    serverUrl: string
    vaultId: string
    deviceId: string
    deviceTokenId: string
  }): string | null {
    const now = this.sync.connection.value
    if (
      this.closed ||
      now.serverUrl !== c.serverUrl ||
      now.vaultId !== c.vaultId ||
      now.deviceId !== c.deviceId ||
      now.deviceTokenId !== c.deviceTokenId
    )
      return null
    return boundDeviceToken(secrets().device, c.deviceTokenId, c.serverUrl)
  }
  readonly ownerPublication: NonNullable<SyncServiceDeps['ownerPublication']> = async (context) => {
    if (this.closed) throw new Error('Sharing host is closed')
    const ledger = readLedgerId(this.app)
    if (!ledger.stateId || ledger.vaultId !== context.connection.vaultId)
      throw new Error('Owner publication requires the bound local personal ledger')
    const c = { ...context.connection }
    const binding: SnapshotBinding = {
      localVault: ledger.stateId,
      issuer: c.serverUrl,
      vaultId: c.vaultId,
      principal: c.deviceId,
      facet: 'personal',
      grantId: null,
    }
    // Re-enrolment changes the principal; Forget and vault changes can also change the
    // ledger. Keep each identity's evidence separate instead of inheriting decisions or
    // making an unrelated old descriptor prevent this personal engine from starting.
    const identity = await hash(bindingKey(binding))
    const descriptorKey = `${DESCRIPTOR}:${identity}`
    const sentinelPath = `${SENTINEL}-${identity}`
    const legacy = this.app.loadLocalStorage(DESCRIPTOR) as SnapshotDescriptor | null
    const useLegacy =
      !!legacy?.binding &&
      bindingKey(legacy.binding) === bindingKey(binding) &&
      this.app.loadLocalStorage(descriptorKey) == null
    const key = useLegacy ? DESCRIPTOR : descriptorKey
    const sentinel = useLegacy ? SENTINEL : sentinelPath
    await retirePublicationStores(this.app, factoryOf(this.deps), key)
    const resources = await openLinkSnapshots(
      factoryOf(this.deps),
      {
        loadDescriptor: () => this.app.loadLocalStorage(key) as SnapshotDescriptor | null,
        saveDescriptor: (value) => this.app.saveLocalStorage(key, value),
        hasSentinel: () => this.app.vault.adapter.exists(sentinel),
        writeSentinel: () => this.app.vault.adapter.write(sentinel, JSON.stringify(binding)),
      },
      binding,
      () => false
    )
    let runtime: NativeOwnerPublication | null = null
    let detach = () => {}
    let restoreTransaction = () => {}
    try {
      await rememberPublicationStore(
        this.app,
        key,
        sentinel,
        this.app.loadLocalStorage(key) as SnapshotDescriptor
      )
      let grants: string[] = [],
        groups: GroupShareHint[] = [],
        catalogueReadable = true,
        settingsPending = false
      try {
        const raw = await resources.meta.getMeta(AUDIENCES)
        if (raw === null && !resources.fresh) throw new Error('Optional discovery missing')
        const envelope =
          raw === null
            ? { value: { binding, grants: [] as string[] }, checksum: '' }
            : JSON.parse(raw)
        if (
          raw !== null &&
          (envelope.checksum !== (await hash(envelope.value)) ||
            JSON.stringify(envelope.value.binding) !== JSON.stringify(binding))
        )
          throw new Error('Optional discovery binding changed')
        const ids = envelope.value.grants
        if (
          !Array.isArray(ids) ||
          ids.length > 64 ||
          ids.some((id) => typeof id !== 'string' || !id || id.length > 200)
        )
          throw new Error('Optional discovery malformed')
        if (raw === null)
          await resources.meta.setMeta(
            AUDIENCES,
            JSON.stringify({ value: envelope.value, checksum: await hash(envelope.value) })
          )
        groups = groupHints(envelope.value.groups)
        grants = ids
        settingsPending = envelope.value.settingsPending === true
      } catch {
        // Discovery is not consent or personal ledger integrity. Preserve its bad record,
        // pause new sharing effects, and leave ordinary personal sync and management usable.
        catalogueReadable = false
      }
      const held = () =>
        !this.closed &&
        resources.meta.permitsEngineEffects &&
        context.held() &&
        this.token(c) === context.token
      let transactionDepth = 0
      const settling = () => transactionDepth > 0
      // Core's automatic watcher runs independently of the service queue. Track the public
      // ledger transaction boundary too, so a late cache event cannot read an uncommitted
      // overlay or make publication effects while personal settlement is still running.
      // eslint-disable-next-line @typescript-eslint/unbound-method -- restored to the exact same receiver
      const originalTransaction = context.state.transaction
      const transaction = originalTransaction.bind(context.state) as typeof originalTransaction
      const wrappedTransaction: typeof originalTransaction = async (work) => {
        transactionDepth++
        try {
          return await transaction(work)
        } finally {
          transactionDepth--
          if (!settling() && this.linksDirty) this.linksChanged()
        }
      }
      context.state.transaction = wrappedTransaction
      restoreTransaction = () => {
        if (context.state.transaction === wrappedTransaction)
          context.state.transaction = originalTransaction
      }
      runtime = new NativeOwnerPublication({
        app: this.app,
        configurationRoots: () => [
          this.app.vault.configDir,
          AbeleConfig.getInstance().ai.scriptsFolder || 'Scripts',
        ],
        meta: resources.meta,
        state: context.state,
        client: context.client,
        binding,
        token: () => this.token(c),
        // Runtime policy can be paused without deleting durable discovery hints.
        grants: catalogueReadable && grants.length <= 16 ? [...grants] : [],
        fetch: context.fetch,
        held,
        settling,
        linksChanged: () => this.linksChanged(),
      })
      await runtime.start(resources.fresh)
      runtime.setAutomaticPaused(true)
      this.live = {
        context,
        runtime,
        resources,
        binding,
        grants,
        groups,
        catalogueReadable,
        settingsPending,
        signedIn: false,
        serverSnapshot: false,
        held,
        settling,
        restoreTransaction,
      }
      this.ownerAvailable.value = true
      this.audiences.value = [...grants]
      if (catalogueReadable) await this.recordAudiences([])
      else this.pauseDiscovery('Saved sharing choices could not be read')
      detach = this.publicationPrompt.attach(runtime.confirmation)
      await this.publicationPrompt.refresh()
      if (this.linksDirty) this.linksChanged()
      const owner = this.live
      return {
        hooks: runtime.hooks,
        beforeRemote: (paths) => owner.runtime.beforeRemote(paths),
        settled: () => this.refreshPublication(),
        close: () => {
          detach()
          owner.runtime.close()
          restoreTransaction()
          owner.resources.close()
          if (this.live === owner) {
            this.ownerAvailable.value = false
            this.live = null
            this.managementCache?.port.close()
            this.managementCache = null
          }
        },
      }
    } catch (error) {
      detach()
      runtime?.close()
      restoreTransaction()
      if (this.live?.runtime === runtime) {
        this.ownerAvailable.value = false
        this.live = null
        this.managementCache?.port.close()
        this.managementCache = null
      }
      resources.close()
      throw error
    }
  }
  private linksChanged(): void {
    this.linksDirty = true
    if (this.linkRefreshQueued || this.closed || !this.ownerReady) return
    this.linkRefreshQueued = true
    void this.sync
      .refreshSharing()
      .finally(() => {
        this.linkRefreshQueued = false
        if (this.linksDirty && !this.closed && this.ownerReady) this.linksChanged()
      })
      .catch(() => {})
  }
  get ownerReady(): boolean {
    return (
      this.ownerAvailable.value && !!this.live?.held() && !this.live.settling() && !this.scope.value
    )
  }
  private owner() {
    const owner = this.live
    if (!this.ownerAvailable.value || !owner || !owner.held() || this.scope.value)
      throw new Error('Bound owner personal connection required')
    return owner
  }
  private async recordAudience(id: string) {
    await this.recordAudiences([id])
  }
  private async recordAudiences(
    ids: string[],
    remove: string[] = [],
    remembered: GroupShareHint[] = [],
    replace = false
  ) {
    const owner = this.owner()
    const next = this.catalogueQueue.then(async () => {
      if (this.owner() !== owner) throw new Error('Owner audience connection changed')
      const config = AbeleConfig.getInstance()
      owner.runtime.setAutomaticPaused(true)
      this.audiences.value = []
      const useCache = !replace && !(owner.signedIn && owner.serverSnapshot)
      const portable = useCache
        ? audiencesFor(config.sync, owner.binding.issuer, owner.binding.vaultId)
        : []
      const byId = new Map<string, GroupShareHint>()
      for (const group of [
        ...(replace ? [] : owner.groups),
        ...(useCache ? groupsFor(config.sync, owner.binding.issuer, owner.binding.vaultId) : []),
        ...remembered,
      ]) {
        if (remove.includes(group.id)) continue
        const previous = byId.get(group.id)
        if (!previous || group.revision >= previous.revision) byId.set(group.id, group)
      }
      const groups = [...byId.values()]
      const grants = [
        ...new Set([
          ...(replace ? [] : owner.grants),
          ...portable,
          ...ids,
          ...groups
            .filter((group) => ['active', 'preparing'].includes(group.state))
            .map((group) => group.id),
        ]),
      ].filter((id) => !remove.includes(id))
      const overflow = grants.length > 16
      const entry = { issuer: owner.binding.issuer, vaultId: owner.binding.vaultId, grants, groups }
      const existing = Array.isArray(config.sync.sharing) ? config.sync.sharing : []
      const sharing = existing.filter(
        (item) => item?.issuer !== entry.issuer || item?.vaultId !== entry.vaultId
      )
      if (grants.length || groups.length) sharing.push(entry)
      const changed = JSON.stringify(config.sync.sharing ?? []) !== JSON.stringify(sharing)
      const needsSave = changed || owner.settingsPending
      // Pending writes are durable before touching the in-memory settings object. A later
      // equal-object comparison cannot masquerade as a successfully acknowledged save.
      const persist = async (pending: boolean) => {
        const value = { binding: owner.binding, grants, groups, settingsPending: pending }
        const text = JSON.stringify({ value, checksum: await hash(value) })
        await owner.resources.meta.setMeta(AUDIENCES, text)
        if (this.owner() !== owner || (await owner.resources.meta.getMeta(AUDIENCES)) !== text)
          throw new Error('Audience selection was not persisted')
      }
      if (needsSave) owner.settingsPending = true
      await persist(owner.settingsPending)
      owner.groups = groups
      owner.catalogueReadable = true
      owner.grants.splice(0, owner.grants.length, ...grants)
      if (replace) owner.serverSnapshot = true
      if (changed)
        config.editSettings(() => {
          const updated = { ...config.sync }
          if (sharing.length) updated.sharing = sharing
          else delete updated.sharing
          config.sync = updated
        })
      if (needsSave) {
        await config.saveSettings()
        await persist(false)
        owner.settingsPending = false
      }
      if (overflow)
        this.pauseDiscovery(
          'There are more sharing choices than automatic image sharing can currently check'
        )
      else {
        owner.runtime.setAudiences(grants)
        owner.runtime.setAutomaticPaused(false)
        this.audiences.value = [...grants]
        this.discoveryWarning.value = ''
      }
    })
    this.catalogueQueue = next.catch(() => {})
    try {
      await next
    } catch (error) {
      if (this.live !== owner || !owner.held()) throw error
      this.pauseDiscovery(
        error instanceof DiscoveryCatalogueError
          ? 'Sharing discovery data is invalid'
          : 'Sharing choices could not be saved'
      )
    }
  }
  private pauseDiscovery(reason: string) {
    this.owner().runtime.setAutomaticPaused(true)
    this.owner().runtime.setAudiences([])
    this.audiences.value = []
    this.discoveryWarning.value =
      reason +
      '. Personal sync continues. Automatic image sharing is paused; review Sharing to continue.'
  }
  private management() {
    const owner = this.owner(),
      c = owner.context.connection
    const port = new OwnerFolderHttpPort({
      baseUrl: c.serverUrl,
      vaultId: c.vaultId,
      deviceToken: () => this.token(c),
      fetch: transportOf(this.deps),
      configurationRoots: [
        this.app.vault.configDir,
        AbeleConfig.getInstance().ai.scriptsFolder || 'Scripts',
      ],
    })
    for (const verb of ['create', 'prepare', 'createGroup', 'prepareGroup'] as const) {
      const original = port[verb].bind(port) as (...args: any[]) => Promise<any>
      ;(port as any)[verb] = async (...args: any[]) => {
        if (this.owner() !== owner) throw new Error('Owner management connection changed')
        const grant = await original(...args)
        if (grant.rootId && grant.label) {
          await this.recordAudiences(
            grant.state === 'active' ? [grant.id] : [],
            [],
            [
              {
                id: grant.id,
                label: grant.label,
                rootId: grant.rootId,
                role: grant.role,
                revision: grant.revision,
                state: grant.state,
              },
            ]
          )
        } else if (grant.state === 'active') await this.recordAudience(grant.id)
        return grant
      }
    }
    const list = port.list.bind(port)
    port.list = async (session) => {
      if (this.owner() !== owner) throw new Error('Owner management connection changed')
      const shares: OwnerSharedGrant[] = await list(session)
      if (this.owner() !== owner) throw new Error('Owner management connection changed')
      const live = shares.filter(
        (share) =>
          share.revokedAt == null &&
          (share.expiresAt == null || Date.parse(share.expiresAt) > Date.now())
      )
      const active = live
        .filter((share) => ['active', 'preparing'].includes(share.state))
        .map((share) => share.id)
      const groups: GroupShareHint[] = live
        .filter((share) => share.kind === 'group')
        .map((share) => ({
          id: share.id,
          label: share.label,
          rootId: share.rootId!,
          role: share.role,
          revision: share.revision,
          state: share.state as GroupShareHint['state'],
        }))
      // Both authenticated endpoints succeeded: this complete snapshot replaces cache
      // hints, including absent groups and stale ACL revisions, on every fetch.
      await this.recordAudiences(active, [], groups, true)
      return shares
    }
    const revoke = port.revoke.bind(port)
    port.revoke = async (session, share) => {
      if (this.owner() !== owner) throw new Error('Owner management connection changed')
      await revoke(session, share)
      if (this.owner() !== owner) throw new Error('Owner management connection changed')
      await this.recordAudiences([], [share.id])
      await this.sync.refreshSharing()
    }
    return port
  }
  ownerFolder(): FolderSharingFlow {
    return markRaw(new FolderSharingFlow(this.owner().binding.vaultId, this.management()))
  }
  ownerGroup(): OwnerGroupRootFlow {
    const owner = this.owner()
    return markRaw(
      new OwnerGroupRootFlow(
        this.management(),
        async (identity) => {
          if (this.owner() !== owner) throw new Error('Owner group connection changed')
          const entry =
            (await owner.context.state.get(identity)) ??
            (await owner.context.state.byFileId(identity))
          if (!entry) throw new Error('Choose a synced group root')
          let cursor: string | null = null
          let pages = 0
          do {
            const page = await owner.context.client.manifest(cursor)
            if (++pages > 100) throw new Error('Group root inventory incomplete')
            const item = page.items.find((file) => file.file_id === entry.fileId)
            if (item) {
              if (
                item.kind !== 'note' ||
                [
                  this.app.vault.configDir,
                  AbeleConfig.getInstance().ai.scriptsFolder || 'Scripts',
                ].some((root) => item.path === root || item.path.startsWith(root + '/'))
              )
                throw new Error('Group root must be an ordinary synced note')
              const root: GroupRoot = {
                fileId: item.file_id,
                versionId: item.version_id,
                sha: item.sha,
                path: item.path,
              }
              if (this.owner() !== owner) throw new Error('Owner group connection changed')
              return root
            }
            cursor = page.next ?? null
          } while (cursor)
          throw new Error('Group root is no longer current')
        },
        () => this.live === owner && owner.held()
      )
    )
  }
  ownerManagement(): OwnerFolderHttpPort {
    const owner = this.owner()
    if (this.managementCache?.owner === owner) return this.managementCache.port
    this.managementCache?.port.close()
    const port = this.management()
    const authorize = port.authorize.bind(port),
      close = port.close.bind(port)
    port.authorize = async (password, email) => {
      const session = await authorize(password, email)
      if (this.owner() !== owner) throw new Error('Owner management connection changed')
      owner.signedIn = true
      return session
    }
    port.close = () => {
      owner.signedIn = false
      close()
    }
    this.managementCache = { owner, port }
    return port
  }
  /** Revalidate retained publication work outside the personal settlement transaction. */
  async refreshPublication(): Promise<void> {
    const owner = this.owner()
    if (owner.settling()) {
      this.linksDirty = true
      return
    }
    this.linksDirty = false
    if (owner.catalogueReadable) {
      try {
        const portable =
          owner.signedIn && owner.serverSnapshot
            ? []
            : audiencesFor(
                AbeleConfig.getInstance().sync,
                owner.binding.issuer,
                owner.binding.vaultId
              )
        if (owner.settingsPending || portable.some((id) => !owner.grants.includes(id)))
          await this.recordAudiences(portable)
      } catch (error) {
        if (!(error instanceof DiscoveryCatalogueError)) throw error
        this.pauseDiscovery('Sharing discovery data is invalid')
      }
    }
    await owner.runtime.flush()
    try {
      await owner.runtime.refreshPublication()
    } finally {
      await this.publicationPrompt.refresh()
    }
  }
  invitation(issuer: string) {
    return this.scoped.invitation(issuer)
  }
  createScoped() {
    return this.scoped.creation()
  }
  async retirePublication(forget = false): Promise<void> {
    if (this.live) throw new Error('Publication retirement requires engine teardown')
    await retirePublicationStores(this.app, factoryOf(this.deps), null, forget)
  }
  async close() {
    this.closed = true
    this.ownerAvailable.value = false
    this.managementCache?.port.close()
    this.managementCache = null
    this.live?.runtime.close()
    this.live?.restoreTransaction()
    this.live?.resources.close()
    this.live = null
    await this.scoped.close()
  }
}
