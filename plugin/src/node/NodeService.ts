import { ref, type Ref } from 'vue'
import { NodeClient, PairedWssConnector } from '@abele/node-client'
import { type PairingInvite, fingerprint } from '@abele/channel-protocol'
import { NodeDeviceKeyStore } from './NodeDeviceKeyStore'
import { GlobalStore } from '@/stores/GlobalStore'
import { secrets } from '@/secrets/SecretStore'
import { NodeRegistry, channelUrl, isPairedNode, type RegisteredNode } from './NodeRegistry'
import { NodeClientStore } from './NodeClientStore'

export type NodeConnectionState = 'connecting' | 'connected' | 'offline'
export class NodeConnection {
  readonly state: Ref<NodeConnectionState> = ref('offline')
  readonly error = ref('')
  private disposed = false
  private generation = 0
  private timer?: number
  private connecting?: Promise<void>
  constructor(
    readonly client: NodeClient,
    readonly store: NodeClientStore
  ) {}

  connect(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Node connection closed'))
    if (this.connecting) return this.connecting
    if (this.client.connected) {
      this.state.value = 'connected'
      return Promise.resolve()
    }
    this.state.value = 'connecting'
    const generation = this.generation
    this.connecting = this.client
      .connect()
      .then(async () => {
        if (this.disposed || generation !== this.generation) {
          await this.client.disconnect()
          return
        }
        this.error.value = ''
        this.state.value = 'connected'
      })
      .catch((error: unknown) => {
        if (generation === this.generation) {
          this.state.value = 'offline'
          this.error.value = error instanceof Error ? error.message : 'Connection failed'
        }
        throw error
      })
      .finally(() => {
        if (generation === this.generation) this.connecting = undefined
      })
    return this.connecting
  }

  /** Keep the client, subscriptions and store alive across same-principal re-pairing.
   * Settle the old admission before reusing NodeClient; a late channel is discarded.
   */
  async refreshAuthorization(): Promise<void> {
    ++this.generation
    window.clearTimeout(this.timer)
    this.state.value = 'offline'
    this.error.value = ''
    const old = this.connecting
    await old?.catch(() => {})
    await this.client.disconnect()
    this.connecting = undefined
  }

  /** Plugin-owned retry/foreground lifetime, independent of which tab is visible. */
  start(): void {
    const generation = this.generation
    const tick = async () => {
      if (this.disposed) return
      if (!this.client.connected) {
        this.state.value = 'offline'
        await this.connect().catch(() => {})
      } else this.state.value = 'connected'
      if (!this.disposed && generation === this.generation)
        this.timer = window.setTimeout((): void => {
          void tick()
        }, 2000)
    }
    void tick()
  }

  destroy(): void {
    this.disposed = true
    window.clearTimeout(this.timer)
    void this.client.disconnect().finally(() => this.store.close())
  }
}

/** Obsidian adapter: local preferences + local keychain, not AbeleSettings/transfer. */
export class NodeService {
  private static instance: NodeService | null = null
  readonly nodes: Ref<RegisteredNode[]>
  readonly registry: NodeRegistry
  readonly deviceKeys = new NodeDeviceKeyStore()
  readonly pairedConnector = new PairedWssConnector(this.deviceKeys)
  private readonly connections = new Map<string, NodeConnection>()
  private readonly installation: string
  private readonly foreground = () => {
    if (document.visibilityState !== 'hidden')
      for (const connection of this.connections.values()) void connection.connect().catch(() => {})
  }

  static getInstance(): NodeService {
    return (this.instance ??= new NodeService())
  }
  static destroyCurrent(): void {
    this.instance?.destroy()
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

  async add(label: string, url: string, token: string): Promise<RegisteredNode> {
    const id = crypto.randomUUID()
    const store = new NodeClientStore(`${this.installation}-${id}`)
    const client = new NodeClient({ url: channelUrl(url), profile: 'local-token-v1', token }, store)
    try {
      await client.connect()
      const expectedNodeId = await store.transaction((state) => state.node_id!)
      const node = { id, label, url, expectedNodeId }
      this.registry.add(node, token)
      this.nodes.value = this.registry.list()
      const connection = new NodeConnection(client, store)
      this.connections.set(id, connection)
      connection.start()
      return node
    } catch (error) {
      await client.disconnect()
      store.close()
      throw error
    }
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
    this.registry.addPaired({
      id,
      label,
      url: device.endpoint,
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
            url: node.url,
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
    const connection = new NodeConnection(client, store)
    this.connections.set(id, connection)
    connection.start()
    return connection
  }

  remove(id: string): void {
    this.connections.get(id)?.destroy()
    this.connections.delete(id)
    this.registry.remove(id)
    this.nodes.value = this.registry.list()
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
