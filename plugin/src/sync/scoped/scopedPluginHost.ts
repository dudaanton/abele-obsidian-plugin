import { type App, TFile, Notice } from 'obsidian'
import { AbeleError } from '@abele/sync-protocol'
import { markRaw, ref, shallowRef } from 'vue'
import {
  createScopedClient,
  ScopedState,
  pullScoped,
  pushScoped,
  scanScopedChanges,
  sha256,
  type ScopedClient,
  type StateEntry,
} from '@abele/sync-core'
import { AbeleConfig } from '@/services/AbeleConfig'
import { secrets } from '@/secrets/SecretStore'
import { pendingTeardown } from '../teardownBarrier'
import { IndexedDbStateStore } from '../IndexedDbStateStore'
import { StateRecoveryRequired } from '../idbIdentity'
import { ObsidianFileSystem } from '../ObsidianFileSystem'
import { GroupJoinHttp } from './groupJoinHttp'
import {
  ScopedJoinFlow,
  SCOPED_CONNECTION_KEY,
  SCOPED_JOIN_KEY,
  type ScopedJoinPort,
  type ScopedLocalConnection,
} from './scopedJoin'
import {
  ScopedCreationFlow,
  type ScopedCreationPort,
  type CreationScope,
  type NativeCreationRequest,
  type ApprovedRoot,
  type NativeSponsor,
} from './scopedCreation'
import { SponsoredAssetsHttpPort } from '../sharing/sponsoredHttp'
import { scopedSecretPort } from './scopedSecretSlots'
import { fetchWithAbort, waitWithAbort } from './abortableTransport'
import { RuntimeFence, fencedPort } from '../external/recovery'
import { runtimeTransport } from '../external/runtimeTransport'
import {
  checkExternalMigration,
  connectionGeneration,
  generationHeld,
  recoverExternalState,
  requireExternalLifecycleSafety,
  activateExternalFiles,
} from '../external/pluginSafety'
import { ConnectionBindingSchema, type ConnectionBinding } from '../external/records'
import { pluginRepresentation } from '../external/pluginRepresentation'
import { AttachmentStore } from '../external/attachmentStore'
import { ExternalFileHost } from '../external/ObsidianExternalFileHost'
import type { ExternalRepresentation } from '../external/representation'

const digest = (value: unknown) => sha256(new TextEncoder().encode(JSON.stringify(value)))
const CREATION_JOURNAL = 'scoped-creation-journal-v1'
const ACCESS_REMOVED = 'abele-scoped-access-removed'
const DISPLAY_NAME = 'abele-scoped-display-name'
const SELF_REVOKE_TIMEOUT_MS = 5000
interface CreationJournal {
  binding: ScopedClient['binding']
  handle: string
  path: string
  sha: string
  size: number
  requestId: string | null
}
interface Runtime {
  credential: string
  fence: RuntimeFence
  connection: ScopedLocalConnection
  client: ScopedClient
  state: ScopedState
  raw: IndexedDbStateStore
  meta: IndexedDbStateStore
  fs: ObsidianFileSystem
  assets: SponsoredAssetsHttpPort
  binding: ConnectionBinding
  representations: ExternalRepresentation
  attachments?: AttachmentStore
}
/** Thin Obsidian ports around the same scoped client/state/pull/push used by stand peers. */
export class ScopedPluginHost {
  readonly connection = shallowRef<ScopedLocalConnection | null>(null)
  readonly paused = ref(false)
  readonly accessRemoved = ref('')
  private leaving = false
  private requests = new AbortController()
  private revocation: AbortController | null = null
  private departure: RuntimeFence | null = null
  private readonly transport: typeof fetch = (input, init) => {
    const c = this.connection.value
    const self =
      c &&
      `${c.issuer}/v1/scoped/vaults/${encodeURIComponent(c.vaultId)}/grants/${encodeURIComponent(c.grantId)}/self`
    const revoking =
      this.leaving && this.revocation && init?.method === 'DELETE' && String(input) === self
    if (revoking) {
      try {
        this.departure?.assertReady()
        if (!this.departure) throw new Error('Scoped departure requires recovery')
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error('Scoped departure refused', { cause: error })
        )
      }
    }
    if (this.closed || (this.leaving && !revoking))
      return Promise.reject(new Error('Scoped connection is closing'))
    return fetchWithAbort(
      this.fetcher,
      (revoking ? this.revocation! : this.requests).signal,
      input,
      init
    )
  }
  readonly role = ref<'reader' | 'editor' | null>(null)
  private runtime: Runtime | null = null
  private closed = false
  private tail: Promise<unknown> = Promise.resolve()
  private unwatch: (() => void) | null = null
  private clock: number | null = null
  private flows = new Set<{ close(): void }>()
  constructor(
    private readonly app: App,
    private readonly fetcher: typeof fetch,
    private readonly factory: IDBFactory,
    private readonly status: (
      state: 'disconnected' | 'idle' | 'syncing' | 'paused' | 'error',
      error?: string
    ) => void = () => {}
  ) {
    this.paused.value = app.loadLocalStorage('abele-scoped-paused') === true
    const c = app.loadLocalStorage(SCOPED_CONNECTION_KEY) as ScopedLocalConnection | null
    if (c) {
      this.connection.value = c
      this.role.value = c.role
      const removed = app.loadLocalStorage(ACCESS_REMOVED) as {
        connection?: unknown
        message?: string
      } | null
      if (
        JSON.stringify(removed?.connection) === JSON.stringify(c) &&
        typeof removed?.message === 'string'
      )
        this.accessRemoved.value = removed.message
    }
  }
  private serial<T>(step: () => Promise<T>): Promise<T> {
    const previous = pendingTeardown(this.app)
    const task = this.tail.then(async () => {
      if (this.closed) throw new Error('Scoped host is closed')
      await previous
      if (this.closed) throw new Error('Scoped host is closed')
      return step()
    })
    this.tail = task.catch(() => {})
    return task
  }
  private token(c: ScopedLocalConnection) {
    const road = scopedSecretPort(secrets())
    const token = road.get(c.tokenId)
    if (
      c.version !== 4 ||
      c.facet !== 'scoped' ||
      c.principalKind !== 'installation' ||
      c.scriptPolicy !== 'refuse' ||
      !/^absi_[A-Za-z0-9_-]{43}$/.test(token) ||
      road.get(c.tokenId + ':binding') !== JSON.stringify({ connection: c, token })
    )
      throw new Error('Scoped installation credential/binding requires recovery')
    return token
  }
  private held(r: Runtime) {
    if (
      this.closed ||
      this.leaving ||
      !!this.accessRemoved.value ||
      this.runtime !== r ||
      !r.fence.owns() ||
      !r.raw.permitsEngineEffects ||
      !r.meta.permitsEngineEffects
    )
      return false
    const current = this.app.loadLocalStorage(SCOPED_CONNECTION_KEY)
    // During allocation/pull the exact descriptor is retained in the scoped join record.
    const pending = this.app.loadLocalStorage('abele-sync-scoped-join') as {
      connection?: unknown
    } | null
    if (JSON.stringify(current ?? pending?.connection) !== JSON.stringify(r.connection))
      return false
    try {
      return this.token(r.connection) !== ''
    } catch {
      return false
    }
  }
  private roots() {
    return [this.app.vault.configDir, AbeleConfig.getInstance().ai.scriptsFolder || 'Scripts']
  }
  private async identity(
    store: IndexedDbStateStore,
    key: string,
    expected: string,
    initialize = true
  ): Promise<void> {
    const stored = await store.getMeta(key)
    if (stored !== null && stored !== expected)
      throw new Error('Scoped database identity binding changed')
    if (stored === null) {
      if (!initialize) throw new StateRecoveryRequired()
      await store.setMeta(key, expected)
    }
    if ((await store.getMeta(key)) !== expected)
      throw new Error('Scoped database identity was not persisted')
  }
  private async open(c: ScopedLocalConnection, initialize: boolean): Promise<Runtime> {
    if (this.closed) throw new Error('Scoped host is closed')
    if (this.runtime) {
      if (JSON.stringify(this.runtime.connection) !== JSON.stringify(c) || !this.held(this.runtime))
        throw new Error('Scoped runtime binding changed')
      return this.runtime
    }
    await checkExternalMigration(this.app, this.factory)
    let raw: IndexedDbStateStore | null = null
    let binding: ConnectionBinding | null = null
    const database = 'abele-scoped-' + c.ledgerId
    const descriptor = JSON.stringify(c)
    const token = this.token(c)
    const fence = new RuntimeFence(this.app, database, () => {
      const pending = this.app.loadLocalStorage(SCOPED_JOIN_KEY) as { connection?: unknown } | null
      return (
        !this.closed &&
        !this.leaving &&
        !this.accessRemoved.value &&
        this.token(c) === token &&
        (!raw || raw.permitsEngineEffects) &&
        JSON.stringify(this.app.loadLocalStorage(SCOPED_CONNECTION_KEY) ?? pending?.connection) ===
          descriptor &&
        (!binding || generationHeld(this.app, binding))
      )
    })
    let client: ScopedClient
    try {
      await fence.settlePredecessors()
      client = await createScopedClient({
        baseUrl: c.issuer,
        vaultId: c.vaultId,
        grantId: c.grantId,
        principalId: c.principalId,
        principalKind: 'installation',
        token,
        fetch: (input, init) => {
          if (this.leaving && this.revocation && init?.method === 'DELETE')
            return this.transport(input, init)
          return runtimeTransport(fence, this.transport)(input, init)
        },
      })
      fence.assertOwned()
      const partial = {
        endpoint: c.issuer,
        vaultId: c.vaultId,
        mode: 'scoped' as const,
        principalId: c.principalId,
        principalType: c.principalKind,
        grantId: c.grantId,
        credentialAssociation: c.tokenId + ':' + client.binding.credential_fingerprint,
      }
      binding = ConnectionBindingSchema.parse({
        ...partial,
        generation: connectionGeneration(this.app, partial),
      })
      raw = await IndexedDbStateStore.open(this.factory, database, {
        identity: {
          key: 'scoped-plugin-identity-v4',
          value: JSON.stringify({ connection: c, binding: client.binding }),
        },
      })
      raw.guardEffects(() => fence.assertOwned())
      await recoverExternalState(this.app, raw, c.ledgerId, database, binding, fence)
    } catch (error) {
      raw?.close()
      fence.release()
      throw error
    }
    const expected = JSON.stringify({ connection: c, binding: client.binding })
    let meta: IndexedDbStateStore | null = null
    try {
      // Capture before core initialization writes anything. An existing core ledger is
      // independent evidence that native metadata must already exist, even on cold open.
      const fresh = initialize && (await raw.pluginMeta()).size === 0
      let state = await ScopedState.open(raw, client.binding, { initialize })
      // The core header has proved this exact scope before adding the stable reconnect
      // identity (including upgrading ledgers written before these headers existed).
      await this.identity(raw, 'scoped-plugin-identity-v4', expected)
      meta = await IndexedDbStateStore.open(this.factory, 'abele-scoped-native-' + c.ledgerId, {
        identity: { key: 'scoped-native-identity-v4', value: expected },
      })
      meta.guardEffects(() => fence.assertOwned())
      await this.identity(meta, 'scoped-native-identity-v4', expected, fresh)
      if (this.closed) throw new Error('Scoped host closed during database opening')
      const physicalFs = new ObsidianFileSystem(this.app, {
        ledger: state.placementStore(),
        runtimeFence: fence,
      })
      await physicalFs.recover()
      fence.activate()
      client = fencedPort(client, fence, ['commit', 'putBlob'])
      const representations = await pluginRepresentation({
        app: this.app,
        store: raw,
        ledger: state.placementStore(),
        scoped: state,
        ledgerId: c.ledgerId,
        binding,
        fence,
        fs: physicalFs,
        verify: (fileId, input) => client.verifyExternalFile(fileId, input),
        scriptsFolder: () => AbeleConfig.getInstance().ai.scriptsFolder || 'Scripts',
      })
      await representations.recoverJobs()
      client = representations.scopedClient(client)
      state = representations.scopedState(state)
      const fs = representations.fileSystem() as ObsidianFileSystem
      const r: Runtime = {
        credential: token,
        fence,
        connection: structuredClone(c),
        client,
        state,
        raw,
        meta,
        fs,
        binding,
        representations,
        assets: new SponsoredAssetsHttpPort({
          baseUrl: c.issuer,
          fetch: this.transport,
          context: {
            facet: 'scoped',
            vaultId: c.vaultId,
            principalId: c.principalId,
            token: () => (this.held(r) ? this.token(c) : null),
          },
        }),
      }
      // Every send, including watcher/timer journal replay, must retain the receipt
      // before core may materialize the result and retire its journal.
      const commit = client.commit.bind(client)
      client.commit = async (unit) => {
        const index = await this.creationJournal(r)
        const op = unit.ops[0]
        const matches =
          index &&
          unit.ops.length === 1 &&
          op?.op === 'create' &&
          op.path === index.path &&
          op.sha === index.sha &&
          op.size === index.size
        if (matches) {
          if (index.requestId !== null && index.requestId !== unit.request_id)
            throw new Error('Scoped creation journal request identity changed')
          index.requestId = unit.request_id
          await this.saveCreationJournal(r, index)
        }
        const reply = await commit(unit)
        if (matches) {
          const result = reply.results.find((item: { path?: string }) => item.path === index.path)
          // Compact filtered acknowledgements are not new creation evidence.
          if (result) {
            const value = {
              binding: client.binding,
              handle: index.handle,
              requestId: unit.request_id,
              op,
              result,
            }
            await r.meta.setMeta(
              'scoped-creation-receipt-v1:' + index.handle,
              JSON.stringify({ value, checksum: await digest(value) })
            )
          }
        }
        return reply
      }
      this.runtime = r
      return r
    } catch (error) {
      meta?.close()
      raw.close()
      fence.release()
      throw error
    }
  }
  /** Explicit API only. Readers and editors use the scoped version endpoint; never a personal blob. */
  async attachments(): Promise<AttachmentStore> {
    const r = this.runtime
    if (!r) throw new Error('Scoped connection is not active')
    r.fence.assertReady()
    if (r.attachments) return r.attachments
    const state = await activateExternalFiles(
      this.app,
      r.raw,
      r.connection.ledgerId,
      'abele-scoped-' + r.connection.ledgerId,
      r.binding,
      () => r.fence.assertReady()
    )
    await r.representations.activate(state)
    const fileHost = new ExternalFileHost(this.app, {
      platform:
        typeof (this.app.vault.adapter as unknown as { fsPromises?: unknown }).fsPromises ===
        'object'
          ? 'desktop'
          : 'mobile',
      assertOwned: () => r.fence.assertReady(),
      effect: (work) => r.fence.effect(work),
    })
    const close = r.raw.close.bind(r.raw)
    r.raw.close = () => {
      fileHost.close()
      close()
    }
    r.attachments = new AttachmentStore({
      state,
      ledger: r.state.placementStore(),
      host: fileHost,
      binding: r.binding,
      assertOwned: () => r.fence.assertReady(),
      serial: { run: (work) => this.serial(work) },
      sync: () => this.sync(),
      verify: (fileId, input) => r.client.verifyExternalFile(fileId, input),
      download: (fileId, versionId) => r.client.version(fileId, versionId),
      scopedHead: (id) => r.state.getKnown(id),
      scriptsFolder: () => AbeleConfig.getInstance().ai.scriptsFolder || 'Scripts',
      refreshed: () => r.representations.refresh(),
      consent: {
        read: () => r.raw.getMeta('abele-sync-external-scoped-warning-v1'),
        write: (value) => r.raw.setMeta('abele-sync-external-scoped-warning-v1', value),
      },
    })
    return r.attachments
  }
  invitation(issuer: string): ScopedJoinFlow {
    const api = new GroupJoinHttp({ baseUrl: issuer, fetch: this.transport })
    const port: ScopedJoinPort = {
      login: (...args) => api.login(...args),
      accept: (...args) => api.accept(...args),
      discover: (...args) => api.discover(...args),
      enrol: (...args) => api.enrol(...args),
      ledger: async (c, initialize) => {
        await this.open(c, initialize)
        return true
      },
      viewState: async (c) => (await (await this.open(c, false)).client.state()).state,
      manifest: async (c) => {
        const { client } = await this.open(c, false)
        let page = await client.openSnapshot()
        const items = [...page.items]
        while (page.next_cursor) {
          if (items.length >= 100000) throw new Error('Scoped join inventory incomplete')
          page = await client.snapshotPage(page.snapshot_id, page.next_cursor)
          items.push(...page.items)
        }
        return items.map((f) => ({
          path: f.path,
          fileId: f.file_id,
          versionId: f.version_id,
          sha: f.sha,
        }))
      },
      localPaths: async () => {
        const r = this.runtime
        const occupied: string[] = []
        for (const file of this.app.vault.getFiles()) {
          const known = r && (await r.state.getEntry(file.path))
          // Only a durably received identity with its exact bytes is our partial pull;
          // matching unmanaged bytes never suppress a collision.
          if (!known || (await sha256(await r!.fs.read(file.path))) !== known.sha)
            occupied.push(file.path)
        }
        return occupied
      },
      pullOnly: async (c, policy) => {
        if (policy.publishLocal !== false || policy.holdLocalCollisions !== true)
          throw new Error('Scoped join requires pull-only collision holds')
        const r = await this.open(c, false)
        await pullScoped({
          client: r.client,
          state: r.state,
          fs: r.fs,
          stillHeld: () => this.held(r),
          configurationDirectories: this.roots(),
        })
      },
    }
    const flow = new ScopedJoinFlow(this.app, scopedSecretPort(secrets()), port)
    const begin = flow.begin.bind(flow)
    flow.begin = (invitation) =>
      this.serial(async () => {
        await requireExternalLifecycleSafety(this.app, this.factory)
        await begin(invitation)
      })
    const resume = flow.resume.bind(flow)
    flow.resume = (password) =>
      this.serial(async () => {
        const result = await resume(password)
        if (result.phase === 'joined') {
          this.connection.value = this.app.loadLocalStorage(
            SCOPED_CONNECTION_KEY
          ) as ScopedLocalConnection
          this.watch()
          this.status(this.paused.value ? 'paused' : 'idle')
        }
        return result
      })
    this.flows.add(flow)
    return markRaw(flow)
  }
  async start() {
    // Capture before awaiting, just as the personal runner does. Never include our own
    // later teardown in a barrier that this start is already waiting behind.
    const previous = pendingTeardown(this.app)
    await previous
    if (this.closed) return
    const c = this.connection.value
    if (!c) return
    if (this.accessRemoved.value) {
      this.status('error', this.accessRemoved.value)
      return
    }
    await this.serial(async () => {
      await this.open(c, false)
      // A verified ledger owns automatic triggers even if the first network request
      // fails. Otherwise an offline launch can never recover without another reload.
      this.watch()
      try {
        await this.run()
        this.status(this.paused.value ? 'paused' : 'idle')
      } catch (error) {
        await this.failure(error)
        throw error
      }
    })
  }
  private watch() {
    if (this.unwatch || this.closed || !this.runtime || !this.held(this.runtime)) return
    const r = this.runtime
    this.unwatch = r.fs.watch(() => {
      void this.sync().catch(() => {})
    })
    this.clock = window.setInterval(() => {
      void this.sync().catch(() => {})
    }, 60000)
  }
  get active(): boolean {
    return this.runtime !== null && this.held(this.runtime)
  }
  setPaused(paused: boolean) {
    if (this.accessRemoved.value || this.leaving) return
    this.app.saveLocalStorage('abele-scoped-paused', paused)
    if (this.app.loadLocalStorage('abele-scoped-paused') !== paused)
      throw new Error('Scoped pause was not persisted')
    this.paused.value = paused
    this.status(paused ? 'paused' : 'idle')
  }
  sync(): Promise<void> {
    return this.serial(async () => {
      if (!this.connection.value || this.accessRemoved.value || this.leaving) return
      this.watch()
      if (this.paused.value) return
      this.status('syncing')
      try {
        await this.run()
        this.status('idle')
      } catch (error) {
        await this.failure(error)
        throw error
      }
    })
  }
  private stopWatching() {
    this.unwatch?.()
    this.unwatch = null
    if (this.clock) window.clearInterval(this.clock)
    this.clock = null
  }
  private async failure(error: unknown) {
    if (this.closed || this.leaving || (this.runtime && !this.runtime.fence.claimHeld())) return
    // Only credential/authority denial means access ended. View preparation, snapshot
    // expiry and offline failures remain retryable; scope_unavailable is not revocation.
    if (error instanceof AbeleError && error.code === 'unauthorized' && this.runtime) {
      const r = this.runtime
      const display = this.app.loadLocalStorage(DISPLAY_NAME) as {
        connection?: unknown
        name?: string
      } | null
      const known = await r.state.getKnown(r.connection.rootFileId)
      const name =
        JSON.stringify(display?.connection) === JSON.stringify(r.connection)
          ? display?.name
          : known?.path
      const message = `Access to ${name || 'this shared group'} was removed by its owner.`
      this.accessRemoved.value = message
      this.stopWatching()
      this.app.saveLocalStorage(ACCESS_REMOVED, { connection: r.connection, message })
      for (const flow of this.flows) flow.close()
      this.flows.clear()
      new Notice(message)
      this.status('error', message)
      return
    }
    this.status('error', error instanceof Error ? error.message : 'Scoped sync failed')
  }
  /** Explicit local departure, including after revocation. Never removes vault files. */
  leave(): Promise<void> {
    const original = this.runtime
    try {
      if (original) {
        original.fence.assertClaim()
        if (this.token(original.connection) !== original.credential)
          throw new Error('Scoped credential changed; recovery required')
      }
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error('Scoped departure refused', { cause: error })
      )
    }
    // The departure timeout includes queue settlement and read-only safety inspection.
    // No revoke is issued until inspection succeeds, even if that budget has elapsed.
    let deadlinePassed = false
    const timeout = window.setTimeout(() => {
      deadlinePassed = true
      this.revocation?.abort(new Error('Self-revocation timed out'))
    }, SELF_REVOKE_TIMEOUT_MS)
    this.leaving = true // Fence any in-flight pull/push before waiting behind it.
    this.requests.abort(new Error('Scoped connection is leaving'))
    this.stopWatching()
    for (const flow of this.flows) flow.close()
    this.flows.clear()
    return this.serial(async () => {
      // The queue may have waited while another host became the owner. Do not acquire
      // a new claim over it; an existing runtime lends its exact original claim.
      original?.fence.assertClaim()
      if (original && this.runtime !== original)
        throw new Error('Scoped runtime changed; recovery required')
      const c = this.connection.value
      if (!c) {
        this.requests = new AbortController()
        this.leaving = false
        return
      }
      const token = this.token(c)
      const descriptor = JSON.stringify(c)
      const departure = new RuntimeFence(
        this.app,
        'abele-scoped-' + c.ledgerId,
        () =>
          !this.closed &&
          JSON.stringify(this.app.loadLocalStorage(SCOPED_CONNECTION_KEY)) === descriptor &&
          this.token(c) === token,
        original ? { borrow: original.fence } : { requireUnclaimed: true }
      )
      this.departure = departure
      try {
        await departure.settlePredecessors()
        await requireExternalLifecycleSafety(this.app, this.factory)
        departure.activate()
      } catch (error) {
        this.requests = new AbortController()
        this.leaving = false
        this.status('error', error instanceof Error ? error.message : 'External recovery required')
        throw error
      }
      let toldServer = false
      const revocation = new AbortController()
      this.revocation = revocation
      try {
        const client =
          this.runtime?.client ??
          (await createScopedClient({
            baseUrl: c.issuer,
            vaultId: c.vaultId,
            grantId: c.grantId,
            principalId: c.principalId,
            principalKind: 'installation',
            token: this.token(c),
            fetch: this.transport,
          }))
        const request = client.revokeSelf()
        // waitWithAbort may reject before subscribing when the departure budget expired.
        void request.catch(() => {})
        if (deadlinePassed) revocation.abort(new Error('Self-revocation timed out'))
        await waitWithAbort(revocation.signal, () => request)
        toldServer = true
      } catch {
        // Explicit local departure does not require network access. Report that the
        // server was not told only after all local cleanup has actually succeeded.
      } finally {
        window.clearTimeout(timeout)
        revocation.abort()
        this.revocation = null
      }
      departure.assertReady()
      this.runtime?.raw.close()
      this.runtime?.meta.close()
      this.runtime = null
      await IndexedDbStateStore.delete(this.factory, 'abele-scoped-' + c.ledgerId)
      departure.assertReady()
      await IndexedDbStateStore.delete(this.factory, 'abele-scoped-native-' + c.ledgerId)
      departure.assertReady()
      const road = scopedSecretPort(secrets())
      const pending = this.app.loadLocalStorage(SCOPED_JOIN_KEY) as { invitationId?: string } | null
      const keys = [c.tokenId, c.tokenId + ':binding']
      if (pending?.invitationId)
        keys.push(...['', ':binding', ':accepted'].map((suffix) => pending.invitationId + suffix))
      for (const key of keys) {
        road.set(key, '')
        if (road.get(key)) throw new Error('Scoped connection key could not be forgotten')
      }
      for (const key of [
        SCOPED_CONNECTION_KEY,
        SCOPED_JOIN_KEY,
        'abele-scoped-paused',
        ACCESS_REMOVED,
        DISPLAY_NAME,
      ]) {
        this.app.saveLocalStorage(key, null)
        if (this.app.loadLocalStorage(key) != null)
          throw new Error('Scoped connection state could not be cleared')
      }
      original?.fence.release()
      this.connection.value = null
      this.role.value = null
      this.paused.value = false
      this.accessRemoved.value = ''
      this.requests = new AbortController()
      this.leaving = false
      this.status('disconnected')
      if (!toldServer)
        new Notice(
          'Left this shared group on this device. The server could not be told; the local connection key is forgotten.'
        )
    })
      .catch((error) => {
        this.requests = new AbortController()
        this.leaving = false
        if (!this.closed)
          this.status('error', error instanceof Error ? error.message : 'Scoped recovery required')
        throw error
      })
      .finally(() => {
        window.clearTimeout(timeout)
        this.departure?.release()
        this.departure = null
      })
  }
  private async run() {
    if (this.paused.value) return
    const r = this.runtime
    if (!r || !this.held(r)) throw new Error('Scoped writer ownership lost')
    const remote = await r.client.state()
    if (!this.held(r)) throw new Error('Scoped writer ownership lost')
    this.role.value = remote.role
    const name =
      remote.selector.kind === 'folder'
        ? remote.selector.prefix
        : (await r.state.getKnown(r.connection.rootFileId))?.path
    if (name) this.app.saveLocalStorage(DISPLAY_NAME, { connection: r.connection, name })
    if (remote.state !== 'active') return
    if (remote.role === 'editor') {
      // '/' cannot match a normal vault-relative path: group untracked files need explicit
      // creation review. Folder-native creates use only the server's certified prefix.
      const prefix = remote.selector.kind === 'folder' ? remote.selector.prefix : '/'
      const ops = await scanScopedChanges(r.fs, r.state, prefix, this.roots())
      if (ops.length || (await r.state.getJournal()))
        await pushScoped({
          client: r.client,
          state: r.state,
          fs: r.fs,
          ops,
          stillHeld: () => this.held(r),
          configurationDirectories: this.roots(),
        })
    }
    await pullScoped({
      client: r.client,
      state: r.state,
      fs: r.fs,
      stillHeld: () => this.held(r),
      configurationDirectories: this.roots(),
    })
  }
  creation(): Promise<
    ScopedCreationFlow & { roots: ApprovedRoot[]; sponsors: (NativeSponsor & { label: string })[] }
  > {
    return this.serial(() => this.creationNow())
  }
  private async creationNow(): Promise<
    ScopedCreationFlow & { roots: ApprovedRoot[]; sponsors: (NativeSponsor & { label: string })[] }
  > {
    const c = this.connection.value
    if (!c) throw new Error('A joined scoped installation is required')
    const r = await this.open(c, false)
    const scope = async (): Promise<CreationScope> => {
      if (!this.held(r)) throw new Error('Scoped creation connection changed')
      const current = await r.client.state(),
        view = await r.assets.read(c.grantId)
      this.role.value = current.role
      if (!view.active) throw new Error('Scoped publication view is not active')
      const base = {
        issuer: c.issuer,
        vaultId: c.vaultId,
        grantId: c.grantId,
        principalId: c.principalId,
        role: current.role,
        state: current.state,
      }
      if (current.selector.kind === 'folder')
        return { ...base, generation: JSON.stringify([current]), selector: current.selector }
      const root = await r.client.head(current.selector.root_file_id)
      const proof = await r.assets.sponsorProof(c.grantId, root.file_id)
      if (
        !proof.inScope ||
        !proof.intrinsic ||
        proof.fileId !== root.file_id ||
        proof.versionId !== root.version_id
      )
        throw new Error('Current intrinsic group root proof is required')
      return {
        ...base,
        generation: JSON.stringify([current, root.version_id, proof.admissionGeneration]),
        selector: {
          kind: 'group',
          roots: [
            {
              fileId: root.file_id,
              versionId: root.version_id,
              label: root.path,
              spelling: root.path,
              approved: true,
            },
          ],
        },
      }
    }
    const port: ScopedCreationPort = {
      scope,
      exists: (path) => this.app.vault.adapter.exists(path),
      sponsorCurrent: async (s) =>
        JSON.stringify(await r.assets.sponsorProof(c.grantId, s.fileId)) === JSON.stringify(s),
      place: async (path, source) => {
        if (!this.held(r) || (await this.app.vault.adapter.exists(path)))
          throw new Error('Scoped new path is occupied or writer lost')
        if ((await r.fs.stat(path)) !== null) throw new Error('Scoped path became occupied')
        await r.fs.writeAtomic(path, source.bytes, Date.now())
      },
      upload: async (path, source) => {
        if (!this.held(r)) throw new Error('Scoped writer lost')
        if ((await r.representations.classify(path, undefined, source.bytes)).kind !== 'ordinary')
          throw new Error('Held representation cannot be uploaded as a native asset')
        await r.client.putBlob(source.sha, source.bytes)
        return r.assets.proof(c.grantId, source.sha)
      },
      create: (request) => this.create(r, request),
      link: async (sponsorId, path) => {
        const sponsor = await r.state.getKnown(sponsorId)
        if (!sponsor || sponsor.state !== 'materialized')
          throw new Error('Scoped sponsor is not materialized')
        const proof = await r.assets.sponsorProof(c.grantId, sponsorId)
        if (!proof.inScope || !proof.intrinsic || proof.versionId !== sponsor.version_id)
          throw new Error('Scoped sponsor version changed')
        const file = this.app.vault.getAbstractFileByPath(sponsor.path)
        if (!(file instanceof TFile)) throw new Error('Scoped sponsor file missing')
        const before = await this.app.vault.read(file)
        if ((await sha256(new TextEncoder().encode(before))) !== sponsor.sha)
          throw new Error('Scoped sponsor has pending edits')
        await this.app.vault.process(file, (current) => {
          if (current !== before || !this.held(r))
            throw new Error('Scoped sponsor changed during link insertion')
          return (
            current +
            '\n![](' +
            encodeURI(path).replaceAll('(', '%28').replaceAll(')', '%29') +
            ')\n'
          )
        })
      },
    }
    const flow = new ScopedCreationFlow(r.meta, port, undefined, () => this.held(r), this.roots())
    const confirm = flow.confirm.bind(flow)
    flow.confirm = (shown) => this.serial(() => confirm(shown))
    const currentScope = await scope()
    const roots = currentScope.selector.kind === 'group' ? currentScope.selector.roots : []
    const sponsors = []
    for (const known of await r.state.knownPage(0, 1000)) {
      if (known.state !== 'materialized' || !known.path.endsWith('.md')) continue
      try {
        const proof = await r.assets.sponsorProof(c.grantId, known.file_id)
        if (proof.inScope && proof.intrinsic && proof.versionId === known.version_id)
          sponsors.push({ ...proof, label: known.path })
      } catch {
        /* unavailable or non-intrinsic facts never become choices */
      }
    }
    this.flows.add(flow)
    return markRaw(Object.assign(flow, { roots, sponsors }))
  }
  private async creationJournal(r: Runtime): Promise<CreationJournal | null> {
    const raw = await r.meta.getMeta(CREATION_JOURNAL)
    if (raw === null) return null
    const envelope = JSON.parse(raw)
    const value = envelope.value as CreationJournal
    if (
      envelope.checksum !== (await digest(value)) ||
      JSON.stringify(value.binding) !== JSON.stringify(r.client.binding) ||
      !value.handle ||
      !value.path ||
      !/^[a-f0-9]{64}$/.test(value.sha) ||
      !Number.isSafeInteger(value.size) ||
      value.size < 0 ||
      (value.requestId !== null && (typeof value.requestId !== 'string' || !value.requestId))
    )
      throw new Error('Scoped creation journal binding changed; recovery required')
    return value
  }
  private async saveCreationJournal(r: Runtime, value: CreationJournal): Promise<void> {
    if (!this.held(r)) throw new Error('Scoped creation writer lost')
    const text = JSON.stringify({ value, checksum: await digest(value) })
    await r.meta.setMeta(CREATION_JOURNAL, text)
    if ((await r.meta.getMeta(CREATION_JOURNAL)) !== text)
      throw new Error('Scoped creation journal identity was not retained')
  }
  private async create(r: Runtime, request: NativeCreationRequest) {
    if (!this.held(r)) throw new Error('Scoped creation writer lost')
    const c = r.connection
    if (request.kind === 'asset') {
      if (!request.sponsor)
        throw new Error('Scoped native asset requires its reviewed intrinsic sponsor')
      const result = await r.assets.nativeCreate(c.grantId, {
        grantId: c.grantId,
        path: request.path,
        localCreateHandle: request.handle,
        sha: request.sha,
        eligible: true,
        sponsor: request.sponsor,
        upload: request.upload,
      })
      const head = await r.client.head(result.fileId)
      if (
        head.version_id !== result.versionId ||
        head.path !== request.path ||
        head.sha !== request.sha
      )
        throw new Error('Native asset receipt differs from the reviewed new file')
      const bytes = await r.fs.read(request.path)
      if ((await sha256(bytes)) !== request.sha) throw new Error('Native asset local bytes changed')
      const entry: StateEntry = {
        path: head.path,
        wirePath: head.path,
        fileId: head.file_id,
        versionId: head.version_id,
        sha: head.sha,
        size: head.size,
        mtime: head.mtime,
      }
      await r.state.placementStore().put(entry)
      await r.state.putKnown({
        file_id: head.file_id,
        version_id: head.version_id,
        path: head.path,
        sha: head.sha,
        size: head.size,
        mtime: head.mtime,
        state: 'materialized',
        dirty: false,
        native: true,
      })
      return { ...result, created: true }
    }
    const key = 'scoped-creation-receipt-v1:' + request.handle
    const previous = await r.meta.getMeta(key)
    if (previous && !(await r.state.getJournal())) {
      const envelope = JSON.parse(previous)
      if (
        envelope.checksum !== (await digest(envelope.value)) ||
        JSON.stringify(envelope.value.binding) !== JSON.stringify(r.client.binding) ||
        envelope.value.handle !== request.handle ||
        !envelope.value.requestId ||
        envelope.value.op?.op !== 'create' ||
        envelope.value.op.path !== request.path ||
        envelope.value.op.sha !== request.sha ||
        envelope.value.op.size !== request.size
      )
        throw new Error('Scoped create receipt binding changed')
      const result = envelope.value.result
      const entry = await r.state.getEntry(request.path)
      if (
        result?.status === 'applied' &&
        (result.creation === undefined || result.creation === 'novel') &&
        result.sha === request.sha &&
        entry?.fileId === result.file_id &&
        entry.versionId === result.version_id &&
        (await sha256(await r.fs.read(request.path))) === request.sha
      )
        return { fileId: entry.fileId, versionId: entry.versionId, created: true }
    }
    const journal = await r.state.getJournal()
    const retained = await this.creationJournal(r)
    if (journal) {
      const op = journal.ops[0]
      if (
        !retained ||
        retained.handle !== request.handle ||
        journal.ops.length !== 1 ||
        op?.op !== 'create' ||
        op.path !== request.path ||
        op.sha !== request.sha ||
        op.size !== request.size
      )
        throw new Error('Scoped creation journal belongs to another reviewed operation')
    }
    // Bind the reviewed handle before core allocates/sends its request. Background
    // recovery can now attach the same handle to the exact durable core journal.
    await this.saveCreationJournal(r, {
      binding: r.client.binding,
      handle: request.handle,
      path: request.path,
      sha: request.sha,
      size: request.size,
      requestId: journal?.request_id ?? null,
    })
    await pushScoped({
      client: r.client,
      state: r.state,
      fs: r.fs,
      ops: [
        {
          op: 'create',
          path: request.path,
          sha: request.sha,
          size: request.size,
          mtime: Date.now(),
        },
      ],
      stillHeld: () => this.held(r),
      configurationDirectories: this.roots(),
    })
    const raw = await r.meta.getMeta(key)
    if (!raw) throw new Error('Scoped create receipt missing; recovery required')
    const envelope = JSON.parse(raw)
    if (
      envelope.checksum !== (await digest(envelope.value)) ||
      JSON.stringify(envelope.value.binding) !== JSON.stringify(r.client.binding) ||
      envelope.value.handle !== request.handle ||
      !envelope.value.requestId ||
      envelope.value.op?.op !== 'create' ||
      envelope.value.op.path !== request.path ||
      envelope.value.op.sha !== request.sha ||
      envelope.value.op.size !== request.size
    )
      throw new Error('Scoped create receipt binding changed')
    const result = envelope.value.result
    // The reviewed scoped create endpoint refuses every occupied identity (no prefer/adopt
    // mode). Its applied CREATE receipt is novelty proof even on the deployed wire that
    // omits the optional creation field; an explicit non-novel outcome still holds.
    if (
      result?.status !== 'applied' ||
      result.path !== request.path ||
      result.sha !== request.sha ||
      (result.creation !== undefined && result.creation !== 'novel')
    )
      throw new Error('Scoped create was not a novel reviewed file')
    return {
      fileId: result.file_id as string,
      versionId: result.version_id as string,
      created: true,
    }
  }
  async close() {
    this.closed = true
    this.departure?.release()
    this.runtime?.fence.release()
    this.requests.abort(new Error('Scoped host is closed'))
    this.revocation?.abort(new Error('Scoped host is closed'))
    for (const flow of this.flows) flow.close()
    this.flows.clear()
    this.stopWatching()
    await this.tail
    this.runtime?.raw.close()
    this.runtime?.meta.close()
    this.runtime = null
  }
}
