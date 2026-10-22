import { uiField, uiMessage, uiErrorMessage } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { ref, type Ref } from 'vue'
import { AgentsService } from '@/agents/AgentsService'
import { NodeClient } from '@abele/node-client'
import { NodePairingConnector } from './NodePairingConnector'
import { RequestChannel } from '@abele/channel-client'
import { mobileBackground } from '@/ai/mobileBackground'
import { type PairingInvite, fingerprint, ChannelError } from '@abele/channel-protocol'
import { NodeDeviceKeyStore, claimedEnrollment } from './NodeDeviceKeyStore'
import { GlobalStore } from '@/stores/GlobalStore'
import { secrets } from '@/secrets/SecretStore'
import { NodeRegistry, channelUrl, isPairedNode, type RegisteredNode } from './NodeRegistry'
import { NodeClientStore } from './NodeClientStore'
import { NodeDelegationController } from './NodeDelegationController'
import { NodeManagerController } from './NodeManagerController'
import type { DelegationCard } from './delegation'
import { NodeObsidianTools } from './NodeObsidianTools'
import { nodeAdvertisesMethod } from './advertisedMethods'
import { ensureNodeAgents } from './nodeAgentTools'
import { nodeScopeEntries } from '@/ai/nodeScope'
import { requireDelegationScope } from '@/ai/tools/node/delegationScope'
import { NodeRequestActivity } from './NodeRequestActivity'

RequestChannel.backgroundActive = () => mobileBackground.active
RequestChannel.debug = (...args) => console.debug(...args)

export type NodeConnectionState = 'connecting' | 'connected' | 'offline'
export class NodeConnection {
  readonly activity = new NodeRequestActivity()
  readonly version = ref('')
  private recordVersion(description: unknown): void {
    if (
      description &&
      typeof description === 'object' &&
      'node_version' in description &&
      typeof description.node_version === 'string'
    )
      this.version.value = description.node_version
  }
  obsidian?: NodeObsidianTools
  readonly state: Ref<NodeConnectionState> = ref('offline')
  readonly error = ref('')
  /** Successful peer probes also signal recovery when the socket stayed admitted. */
  readonly healthEpoch = ref(0)
  readonly manager: NodeManagerController
  readonly managerCards = ref<Record<string, Awaited<ReturnType<NodeManagerController['cards']>>>>(
    {}
  )
  readonly delegation: NodeDelegationController
  readonly delegationCards = ref<Record<string, DelegationCard[]>>({})
  private refreshingDelegations?: Promise<void>
  private disposed = false
  private generation = 0
  private timer?: number
  private connecting?: Promise<void>
  private transportGeneration = 0
  private retryGeneration = 0
  private lastHealthCheck = 0
  constructor(
    readonly client: NodeClient,
    readonly store: NodeClientStore,
    private readonly tools?: { nodeId: string; label: string }
  ) {
    this.manager = new NodeManagerController(client, store)
    this.manager.canApprove = async (parent, run) => {
      const { ChatService } = await import('@/ai/ChatService')
      const chat = ChatService.getInstance()
        .getAllSessions()
        .find((s) => s.delegationParentId === parent)
      const tool = run.method === 'git.v1.integrate' ? 'node_git_integrate' : 'node_command_run'
      if (!chat || !['ask', 'auto'].includes(chat.getToolMode(tool))) return false
      const target = await this.manager.targetFor(parent, run.session_id, run.run_id)
      const node = client.target.expected_node_id
      if (!node) return false
      const verify = (project?: string, workspace?: string, worktree?: string) => {
        const guard = () => {
          if (
            !ChatService.getInstance().getAllSessions().includes(chat) ||
            !['ask', 'auto'].includes(chat.getToolMode(tool))
          )
            throw new Error(t('node.manager.permissionChanged'))
          requireDelegationScope(chat, node, project, workspace, worktree)
        }
        try {
          guard()
          return guard
        } catch {
          return false as const
        }
      }
      const entries = nodeScopeEntries(chat).filter((e) => e.node_id === node)
      if (entries.some((e) => e.kind === 'node')) return verify()
      if (target?.project_id) return verify(target.project_id)
      const resolveWorktree = async (worktree: string) => {
        const projects = new Set(entries.flatMap((e) => (e.kind === 'node' ? [] : [e.project_id])))
        for (const project of projects) {
          let cursor: string | undefined
          do {
            const page = await client.repository.worktrees({
              project_id: project,
              cursor,
              limit: 256,
            })
            const row = page.entries.find((row) => row.worktree_id === worktree)
            if (row) return verify(project, row.workspace_id ?? undefined, worktree)
            if (!page.cursor || page.cursor === cursor) break
            cursor = page.cursor
          } while (cursor)
        }
        return false as const
      }
      const source = (
        run.approval?.input as { params?: { source_worktree_id?: string } } | undefined
      )?.params?.source_worktree_id
      const guards: (() => void)[] = []
      for (const worktree of [
        target?.worktree_id,
        ...(tool === 'node_git_integrate' ? [source] : []),
      ]) {
        if (!worktree) return false
        const guard = await resolveWorktree(worktree)
        if (!guard) return false
        guards.push(guard)
      }
      return () => guards.forEach((guard) => guard())
    }
    this.delegation = new NodeDelegationController(client, store)
    this.delegation.ownerNodeId = tools?.nodeId
    this.delegation.ownerPermissionMode = (provider) => {
      if (!this.tools) return undefined
      const agent = ensureNodeAgents(this.tools.nodeId, this.tools.label, [provider])[0]
      return agent?.node?.permissionModeConfigured || agent?.permissionMode !== 'confirm-all'
        ? agent?.permissionMode
        : undefined
    }
    // The SDK supplies wire deadlines. This host deadline also bounds timer grace
    // while backgrounded, and publishes failure before callers render their error.
    const request = client.request?.bind(client)
    if (request)
      client.request = async (method, params) => {
        const settled = this.activity.start()
        const generation = this.transportGeneration
        let timer: number | undefined
        try {
          return await Promise.race([
            request(method, params),
            new Promise<never>((_, reject) => {
              timer = window.setTimeout(
                () => reject(new ChannelError('outcome_unknown')),
                method === 'lsp.v1.install'
                  ? 660000
                  : /^(project|workspace|review|repository)\./.test(method)
                    ? 60000
                    : 10000
              )
            }),
          ])
        } catch (error) {
          if (
            error instanceof ChannelError &&
            ['outcome_unknown', 'disconnected'].includes(error.code)
          ) {
            const failure = new ChannelError(
              error.code,
              `${error.code}: No answer from the node; the request may have completed.`
            )
            // An operation deadline says nothing about the socket's health. The regular
            // node.describe probe owns reconnects; do not strand unrelated approval cards.
            if (
              !this.disposed &&
              generation === this.transportGeneration &&
              (error.code === 'disconnected' ||
                !this.client.connected ||
                method === 'node.describe')
            ) {
              ++this.transportGeneration
              this.state.value = 'offline'
              uiField(this.error, 'value', uiErrorMessage(failure))
              console.debug('[Abele node] request lost; reconnecting', { method })
              void this.client.disconnect().catch(() => {})
            }
            throw failure
          }
          throw error
        } finally {
          settled()
          window.clearTimeout(timer)
        }
      }
  }

  refreshDelegations(): Promise<void> {
    return (this.refreshingDelegations ??= (async () => {
      try {
        await this.delegation.restore()
        await this.manager.restore()
      } finally {
        const parents = await this.store.read((s) => [
          ...new Set(Object.values(s.managerOperations ?? {}).map((e) => e.parent)),
        ])
        const managerCards = Object.fromEntries(
          await Promise.all(
            parents.map(async (parent) => [parent, await this.manager.cards(parent)])
          )
        )
        const cards = await this.delegation.snapshot()
        if (!this.disposed) {
          this.managerCards.value = managerCards
          this.delegationCards.value = cards
          const nodeId = await this.store.read((s) => s.node_id)
          if (nodeId) AgentsService.getInstance().setDelegations(nodeId, cards)
          const { ChatService } = await import('@/ai/ChatService')
          await this.delegation.wakeDelivered(cards, (parent, id, notice) => {
            const session = ChatService.getInstance()
              .getAllSessions()
              .find((s) => s.delegationParentId === parent)
            if (!session) return false
            return session.wakeDelegationResult(id, notice)
          })
          await this.manager.wakeDelivered((parent, notice) => {
            const session = ChatService.getInstance()
              .getAllSessions()
              .find((s) => s.delegationParentId === parent)
            return session?.wakeDelegationResult('', notice) ?? false
          })
        }
      }
    })().finally(() => {
      this.refreshingDelegations = undefined
    }))
  }

  private admitObsidianTools(): void {
    if (
      !this.obsidian &&
      this.tools &&
      nodeAdvertisesMethod(this.client, 'obsidian.tools.v1.advertise')
    ) {
      this.obsidian = new NodeObsidianTools(
        this.client,
        this.store,
        this.tools.nodeId,
        this.tools.label
      )
      this.delegation.obsidianSnapshot = (parent, provider) =>
        this.obsidian!.delegationSnapshot(parent, provider)
      this.delegation.configureChildTools = (session) => this.obsidian!.adoptSession(session)
    }
  }

  private executionPolicyReady = false

  private async enableExecutionPolicy(): Promise<void> {
    if (this.executionPolicyReady) return
    if (!this.client.describe) {
      this.executionPolicyReady = true
      return
    }
    const description = (await this.client.describe()) as {
      capabilities?: { capabilities?: Record<string, { status?: string }> }
    }
    if (description.capabilities?.capabilities?.command_context_v1?.status === 'supported')
      await this.client.request('command.context.v1.enable', {})
    if (description.capabilities?.capabilities?.integration_context_v1?.status === 'supported')
      await this.client.request('integration.context.v1.enable', {})
    if (description.capabilities?.capabilities?.['execution.policy.v1']?.status !== 'supported') {
      this.executionPolicyReady = true
      return
    }
    const result = await this.client.request('execution.policy.v1.enable', {})
    if (!(result as { enabled?: boolean }).enabled) throw new Error('execution_policy_not_enabled')
    // Extended descriptions must be fetched after this connection opts in.
    await this.client.describe()
    this.executionPolicyReady = true
    console.debug('[Abele node] execution policy enabled')
  }

  connect(reason = 'explicit'): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Node connection closed'))
    if (this.connecting) return this.connecting
    if (this.client.connected) {
      return this.enableExecutionPolicy().then(async () => {
        this.admitObsidianTools()
        if (this.client.describe) {
          const description = await this.client.describe()
          this.recordVersion(description)
          await this.obsidian?.connectionChanged(description)
        }
        this.state.value = 'connected'
        uiField(this.error, 'value', uiErrorMessage(''))
        ++this.healthEpoch.value
      })
    }
    console.debug('[Abele node] connect/reconnect', {
      reason,
      backgroundAudio: mobileBackground.active,
    })
    this.state.value = 'connecting'
    this.executionPolicyReady = false
    ++this.transportGeneration
    const generation = this.generation
    this.connecting = this.client
      .connect(() => this.enableExecutionPolicy())
      .then(async () => {
        if (this.disposed || generation !== this.generation) {
          console.debug('[Abele node] disconnect: stale admission')
          await this.client.disconnect()
          return
        }
        await this.enableExecutionPolicy()
        // Re-negotiate capabilities on every admitted transport, before exposing it.
        if (this.client.describe) {
          const description = await this.client.describe()
          this.recordVersion(description)
          this.admitObsidianTools()
          await this.obsidian?.connectionChanged(description)
        }
        if (this.disposed || generation !== this.generation) {
          console.debug('[Abele node] disconnect: stale capability response')
          await this.client.disconnect()
          return
        }
        this.delegation.connectionChanged()
        this.manager.connectionChanged()
        uiField(this.error, 'value', uiErrorMessage(''))
        this.state.value = 'connected'
        console.debug('[Abele node] connected')
      })
      .catch(async (error: unknown) => {
        // NodeClient admits the transport before replaying cached stream cursors. A
        // revoked mailbox must not disable unrelated owner chats or strand the outbox.
        // This applies only AFTER authenticated admission; failed admission never sets
        // client.connected, and all requests still undergo node-side authorization.
        if (
          !this.disposed &&
          generation === this.generation &&
          this.client.connected &&
          error instanceof ChannelError &&
          error.code === 'unauthorized'
        ) {
          this.delegation.connectionChanged()
          this.manager.connectionChanged()
          // NodeClient stops cursor replay on the first unauthorized stream. Probe
          // each saved cursor independently and discard only rejected subscriptions;
          // retained events stay durable. The next reconnect can then replay B.
          const streams = await this.store.transaction((s) => Object.keys(s.cursors))
          for (const stream of streams) {
            try {
              await this.client.subscribe(stream)
            } catch (failure) {
              if (!(failure instanceof ChannelError) || failure.code !== 'unauthorized')
                throw failure
              await this.store.transaction((s) => {
                delete s.cursors[stream]
              })
            }
          }
          await this.client.flush()
          this.state.value = 'connected'
          uiField(this.error, 'value', uiMessage('streamBError.64d6fbbc80'))
          return
        }
        console.debug('[Abele node] connect failed', {
          reason: error instanceof ChannelError ? error.code : 'connection_failed',
        })
        if (generation === this.generation) {
          this.state.value = 'offline'
          uiField(
            this.error,
            'value',
            error instanceof Error ? uiErrorMessage(error) : uiMessage('streamBError.596c52f1eb')
          )
        }
        throw error
      })
      .finally(() => {
        if (generation === this.generation) this.connecting = undefined
      })
    return this.connecting
  }

  /** Read grants bind to this owner-controller generation, never to a transport reconnect. */
  get authorizationGeneration(): number {
    return this.generation
  }

  /** Keep the client, subscriptions and store alive across same-principal re-pairing.
   * Settle the old admission before reusing NodeClient; a late channel is discarded.
   */
  async refreshAuthorization(): Promise<void> {
    ++this.generation
    ++this.transportGeneration
    window.clearTimeout(this.timer)
    this.state.value = 'offline'
    uiField(this.error, 'value', uiErrorMessage(''))
    const old = this.connecting
    await old?.catch(() => {})
    console.debug('[Abele node] disconnect: authorization refresh')
    await this.client.disconnect()
    this.connecting = undefined
  }

  /** Plugin-owned retry/foreground lifetime, independent of which tab is visible. */
  start(): void {
    window.clearTimeout(this.timer)
    const retryGeneration = ++this.retryGeneration
    const generation = this.generation
    const tick = async () => {
      if (
        this.disposed ||
        retryGeneration !== this.retryGeneration ||
        generation !== this.generation
      )
        return
      if (!this.client.connected || !this.executionPolicyReady) {
        this.obsidian?.disconnected()
        this.state.value = 'offline'
        await this.connect('retry_tick').catch(() => {})
      } else if (Date.now() - this.lastHealthCheck >= 15000) {
        this.lastHealthCheck = Date.now()
        // A live socket alone does not prove the peer is answering requests.
        const transportGeneration = this.transportGeneration
        await this.client
          .describe()
          .then(() => {
            if (!this.disposed && transportGeneration === this.transportGeneration) {
              this.state.value = 'connected'
              uiField(this.error, 'value', uiErrorMessage(''))
              ++this.healthEpoch.value
            }
          })
          .catch(() => {})
      }
      // Mailbox restoration must never own the transport retry lifetime.
      void this.refreshDelegations().catch(() => {})
      void this.obsidian
        ?.tick()
        .catch((error: unknown) =>
          console.debug('[Abele node] Obsidian tools synchronization pending', error)
        )
      if (
        !this.disposed &&
        generation === this.generation &&
        retryGeneration === this.retryGeneration
      )
        this.timer = window.setTimeout((): void => {
          void tick()
        }, 2000)
    }
    void tick()
  }

  destroy(): void {
    this.disposed = true
    this.activity.destroy()
    ++this.generation
    ++this.transportGeneration
    this.state.value = 'offline'
    window.clearTimeout(this.timer)
    console.debug('[Abele node] disconnect: connection destroyed')
    void Promise.allSettled([this.obsidian?.destroy(), this.client.disconnect()]).finally(() =>
      this.store.close()
    )
  }
}

/** Obsidian adapter: local preferences + local keychain, not AbeleSettings/transfer. */
export class NodeService {
  /** Presentation may inspect an existing connection without initializing storage. */
  static peekConnection(id: string): NodeConnection | undefined {
    const service = this.instance
    return service?.nodes.value.some((node) => node.id === id)
      ? service.connections.get(id)
      : undefined
  }
  private static instance: NodeService | null = null
  readonly nodes: Ref<RegisteredNode[]>
  readonly registry: NodeRegistry
  readonly deviceKeys = new NodeDeviceKeyStore()
  readonly pairedConnector = new NodePairingConnector(this.deviceKeys)
  private readonly connections = new Map<string, NodeConnection>()
  private readonly installation: string
  private readonly foreground = () => {
    if (document.visibilityState !== 'hidden')
      for (const connection of this.connections.values())
        void connection.connect('foreground').catch(() => {})
  }

  static getInstance(): NodeService {
    return (this.instance ??= new NodeService())
  }
  static destroyCurrent(): void {
    this.instance?.destroy()
  }
  /** File-view enhancements reuse an admitted host connection; they never enroll a node. */
  static connectionIfKnown(id: string): NodeConnection | undefined {
    return this.instance?.connections.get(id)
  }
  /** Stop must not create new services/connections just to remove old waiters. */
  static stopDelegationWaiters(parent: string): Promise<void> {
    const connections = this.instance ? [...this.instance.connections.values()] : []
    return Promise.all(
      connections.flatMap((c) => [c.delegation.stopParent(parent), c.manager.stopParent(parent)])
    ).then((): void => {})
  }
  static resumeDelegationWaiters(parent: string): void {
    for (const connection of this.instance?.connections.values() ?? [])
      connection.delegation.resumeParent(parent)
  }
  private constructor() {
    const { app } = GlobalStore.getInstance()
    this.installation =
      (app.loadLocalStorage('abele-node-installation') as string) || crypto.randomUUID()
    app.saveLocalStorage('abele-node-installation', this.installation)
    this.registry = new NodeRegistry({
      read: () => app.loadLocalStorage('abele-node-registry'),
      write: (nodes) => app.saveLocalStorage('abele-node-registry', nodes),
      getSecret: (id) => secrets().getLocal(id),
      setSecret: (id, value) => secrets().setLocal(id, value),
      removeSecret: (id) => secrets().forgetLocal(id),
    })
    this.nodes = ref(this.registry.list())
    document.addEventListener('visibilitychange', this.foreground)
    window.addEventListener('focus', this.foreground)
  }

  async add(
    label: string,
    url: string,
    token: string,
    expectedNodeId?: string,
    current: () => boolean = () => true
  ): Promise<RegisteredNode> {
    const id = crypto.randomUUID()
    const store = new NodeClientStore(`${this.installation}-${id}`)
    const client = new NodeClient(
      {
        url: channelUrl(url),
        profile: 'local-token-v1',
        token,
        ...(expectedNodeId ? { expected_node_id: expectedNodeId } : {}),
      },
      store
    )
    try {
      console.debug('[Abele node] connect/reconnect', {
        reason: 'registration',
        backgroundAudio: mobileBackground.active,
      })
      await client.connect()
      const admittedNodeId = await store.transaction((state) => state.node_id!)
      if (expectedNodeId && admittedNodeId !== expectedNodeId)
        throw new Error('node_identity_mismatch')
      if (!current()) throw new Error('local_discovery_cancelled')
      const node = { id, label, url, expectedNodeId: admittedNodeId }
      this.registry.add(node, token)
      this.nodes.value = this.registry.list()
      AgentsService.getInstance().setNodes(this.nodes.value)
      const connection = new NodeConnection(client, store, { nodeId: admittedNodeId, label })
      this.connections.set(id, connection)
      connection.start()
      return node
    } catch (error) {
      console.debug('[Abele node] disconnect: registration failed')
      await client.disconnect()
      store.close()
      throw error
    }
  }

  /** The foreground pairing model hands over only an authenticated candidate and its exact store. */
  async adoptPaired(
    label: string,
    client: NodeClient,
    store: NodeClientStore,
    current: () => boolean = () => true
  ): Promise<RegisteredNode> {
    const target = client.target
    if (!client.connected || target.profile !== 'paired-wss-v1' || client.store !== store)
      throw new Error('Authenticated paired admission is required before registration.')
    const nodeId = await store.transaction((state) => state.node_id)
    if (!current()) throw new Error('pairing_cancelled')
    if (nodeId !== target.expected_node_id) throw new Error('node_identity_mismatch')
    const device = await this.deviceKeys.load(nodeId)
    if (
      !device ||
      device.installation_id !== target.installation_id ||
      device.node_fingerprint !== target.node_fingerprint ||
      (device.transport_endpoint ?? device.endpoint) !== target.url ||
      (await fingerprint(device.public_key)) !== (await fingerprint(target.public_key))
    )
      throw new Error('enrollment_changed')
    await (await import('./NodePathObsidianActions')).revokeNodePathChatApprovals(nodeId)
    if (!current() || !client.connected) throw new Error('pairing_cancelled')
    const existing = this.registry
      .list()
      .find((node) => isPairedNode(node) && node.expectedNodeId === nodeId)
    const id = existing?.id ?? crypto.randomUUID()
    this.registry.addPaired({
      id,
      label,
      url: device.endpoint,
      ...(target.url !== device.endpoint ? { transportUrl: target.url } : {}),
      expectedNodeId: nodeId!,
      profile: 'paired-wss-v1',
      installationId: target.installation_id,
      nodeFingerprint: target.node_fingerprint,
      publicKey: target.public_key,
    })
    const previous = this.connections.get(id)
    let connection: NodeConnection
    if (previous) {
      // Existing views, ports, subscriptions and chats retain this client/store identity.
      await previous.refreshAuthorization()
      Object.assign(previous.client.target, target)
      await client.disconnect()
      if (store !== previous.store) store.close()
      connection = previous
      await connection.connect()
    } else {
      connection = new NodeConnection(client, store, { nodeId: nodeId!, label })
      this.connections.set(id, connection)
    }
    this.nodes.value = this.registry.list()
    AgentsService.getInstance().setNodes(this.nodes.value)
    connection.start()
    const enrollment = claimedEnrollment(device)
    if (enrollment) await this.deviceKeys.finishEnrollment(nodeId, enrollment).catch(() => {})
    return this.nodes.value.find((node) => node.id === id)!
  }

  /** Invitation secrets stay in device-local IndexedDB for lost-response recovery. */
  async pair(label: string, invite: PairingInvite): Promise<RegisteredNode> {
    await this.deviceKeys.rememberInvitation(invite, label)
    const claim = await this.pairedConnector.claim(invite)
    const device = await this.deviceKeys.recordClaim(invite, claim)
    if (!device.installation_id) throw new Error('pairing_required')
    const existing = this.registry
      .list()
      .find((n) => isPairedNode(n) && n.expectedNodeId === invite.node_id)
    const id = existing?.id ?? crypto.randomUUID()
    await (await import('./NodePathObsidianActions')).revokeNodePathChatApprovals(invite.node_id)
    this.registry.addPaired({
      id,
      label,
      url: device.endpoint,
      ...(device.transport_endpoint && device.transport_endpoint !== device.endpoint
        ? { transportUrl: device.transport_endpoint }
        : {}),
      expectedNodeId: device.node_id,
      profile: 'paired-wss-v1',
      installationId: device.installation_id,
      nodeFingerprint: device.node_fingerprint,
      publicKey: device.public_key,
    })
    const connection = this.connections.get(id)
    if (connection) {
      await connection.refreshAuthorization()
      connection.start()
    }
    this.nodes.value = this.registry.list()
    AgentsService.getInstance().setNodes(this.nodes.value)
    return this.nodes.value.find((n) => n.id === id)!
  }

  async deviceFingerprint(nodeId: string): Promise<string> {
    const device = await this.deviceKeys.load(nodeId)
    return device ? fingerprint(device.public_key) : ''
  }

  connection(id: string): NodeConnection {
    const existing = this.connections.get(id)
    if (existing) return existing
    const node = this.registry.list().find((node) => node.id === id)
    if (!node) throw new Error('Reconnect this node in Nodes settings')
    const paired = isPairedNode(node)
    const store = new NodeClientStore(
      paired ? `paired-${node.expectedNodeId}-${node.installationId}` : `${this.installation}-${id}`
    )
    const client = new NodeClient(
      paired
        ? {
            profile: 'paired-wss-v1',
            url: node.transportUrl ?? node.url,
            expected_node_id: node.expectedNodeId,
            installation_id: node.installationId,
            node_fingerprint: node.nodeFingerprint,
            public_key: node.publicKey,
          }
        : {
            url: channelUrl(node.url),
            profile: 'local-token-v1',
            token: this.registry.token(id),
            expected_node_id: node.expectedNodeId,
          },
      store,
      paired
        ? {
            connect: async () => {
              // Pins change only through explicit transactional owner verification.
              // Keep the NodeClient/store/subscriptions stable, but authenticate with
              // the currently committed pin after a same-principal re-pair.
              const target = await this.pairedConnector.target(node.expectedNodeId)
              if (
                target.profile !== 'paired-wss-v1' ||
                target.installation_id !== node.installationId
              )
                throw new Error('installation_identity_mismatch')
              return this.pairedConnector.connect(target)
            },
          }
        : undefined
    )
    const connection = new NodeConnection(client, store, {
      nodeId: node.expectedNodeId,
      label: node.label,
    })
    this.connections.set(id, connection)
    connection.start()
    return connection
  }

  /** Cached child sessions only; navigation never opens a connection to discover them. */
  chatChildren(parentId: string): Array<{ registrationId: string; sessionId: string }> {
    return [...this.connections].flatMap(([registrationId, connection]) =>
      (connection.delegationCards.value[parentId] ?? []).flatMap((card) =>
        card.sessionId ? [{ registrationId, sessionId: card.sessionId }] : []
      )
    )
  }

  /** Restore durable mailboxes even when no node or parent chat tab is open. */
  resumeDelegations(): void {
    for (const node of this.nodes.value) {
      try {
        this.connection(node.id)
      } catch {
        /* Registration remains visible for owner repair. */
      }
    }
  }

  remove(id: string): void {
    const node = this.registry.list().find((node) => node.id === id)
    if (node)
      void import('./NodePathObsidianActions')
        .then((module) => module.revokeNodePathChatApprovals(node.expectedNodeId))
        .catch(() => {})
    this.connections.get(id)?.destroy()
    this.connections.delete(id)
    this.registry.remove(id)
    this.nodes.value = this.registry.list()
    AgentsService.getInstance().setNodes(this.nodes.value)
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.foreground)
    window.removeEventListener('focus', this.foreground)
    for (const connection of this.connections.values()) connection.destroy()
    this.connections.clear()
    this.deviceKeys.close()
    NodeService.instance = null
  }
}
