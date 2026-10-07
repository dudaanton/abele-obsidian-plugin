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
import { OwnerFolderHttpPort } from './sharing/ownerHttp'
import { OwnerGroupRootFlow, type GroupRoot } from './sharing/ownerGroupRoot'
import { ScopedPluginHost } from './scoped/scopedPluginHost'

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
  private live: {
    context: Parameters<NonNullable<SyncServiceDeps['ownerPublication']>>[0]
    runtime: NativeOwnerPublication
    resources: Awaited<ReturnType<typeof openLinkSnapshots>>
    binding: SnapshotBinding
    grants: string[]
    held: () => boolean
  } | null = null
  private catalogueQueue: Promise<void> = Promise.resolve()
  readonly audiences = shallowRef<string[]>([])
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
    try {
      await rememberPublicationStore(
        this.app,
        key,
        sentinel,
        this.app.loadLocalStorage(key) as SnapshotDescriptor
      )
      const raw = await resources.meta.getMeta(AUDIENCES)
      if (raw === null && !resources.fresh)
        throw new Error('Publication audiences lost; recovery required')
      const envelope =
        raw === null
          ? { value: { binding, grants: [] as string[] }, checksum: '' }
          : JSON.parse(raw)
      if (
        raw !== null &&
        (envelope.checksum !== (await hash(envelope.value)) ||
          JSON.stringify(envelope.value.binding) !== JSON.stringify(binding))
      )
        throw new Error('Publication audience binding changed; recovery required')
      const grants = envelope.value.grants as string[]
      if (
        !Array.isArray(grants) ||
        grants.length > 16 ||
        grants.some((id) => typeof id !== 'string' || !id)
      )
        throw new Error('Publication audiences malformed')
      if (raw === null)
        await resources.meta.setMeta(
          AUDIENCES,
          JSON.stringify({ value: envelope.value, checksum: await hash(envelope.value) })
        )
      const held = () =>
        !this.closed &&
        resources.meta.permitsEngineEffects &&
        context.held() &&
        this.token(c) === context.token
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
        grants,
        fetch: context.fetch,
        held,
      })
      await runtime.start(resources.fresh)
      this.live = { context, runtime, resources, binding, grants, held }
      this.audiences.value = [...grants]
      detach = this.publicationPrompt.attach(runtime.confirmation)
      await this.publicationPrompt.refresh()
      const owner = this.live
      return {
        hooks: runtime.hooks,
        beforeRemote: (paths) => owner.runtime.beforeRemote(paths),
        settled: () => this.refreshPublication(),
        close: () => {
          detach()
          owner.runtime.close()
          owner.resources.close()
          if (this.live === owner) this.live = null
        },
      }
    } catch (error) {
      detach()
      runtime?.close()
      resources.close()
      throw error
    }
  }
  private owner() {
    const owner = this.live
    if (!owner || !owner.held() || this.scope.value)
      throw new Error('Bound owner personal connection required')
    return owner
  }
  private async recordAudience(id: string) {
    const owner = this.owner()
    const next = this.catalogueQueue.then(async () => {
      if (this.owner() !== owner) throw new Error('Owner audience connection changed')
      const grants = [...new Set([...owner.grants, id])]
      if (grants.length > 16) throw new Error('Publication audience budget reached')
      const value = { binding: owner.binding, grants }
      const text = JSON.stringify({ value, checksum: await hash(value) })
      await owner.resources.meta.setMeta(AUDIENCES, text)
      if ((await owner.resources.meta.getMeta(AUDIENCES)) !== text)
        throw new Error('Audience selection was not persisted')
      owner.runtime.setAudiences(grants)
      owner.grants.splice(0, owner.grants.length, ...grants)
      this.audiences.value = grants
    })
    this.catalogueQueue = next.catch(() => {})
    await next
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
        if (grant.state === 'active') await this.recordAudience(grant.id)
        return grant
      }
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
  /** Revalidate retained publication work outside the personal settlement transaction. */
  async refreshPublication(): Promise<void> {
    const owner = this.owner()
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
    this.live?.runtime.close()
    this.live?.resources.close()
    this.live = null
    await this.scoped.close()
  }
}
