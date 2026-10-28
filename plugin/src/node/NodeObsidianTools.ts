import { Platform } from 'obsidian'
import { z } from 'zod'
import { shallowRef } from 'vue'
import { PromptSchema } from '@abele/node-protocol'
import type { Prompt, QuestionnaireAnswer } from '@abele/node-client'
import { NodeObsidianDelegate, nodeConversation } from './NodeObsidianDelegate'
import type { NodeClient } from '@abele/node-client'
import type { ObsidianToolsSnapshot } from '@abele/node-protocol'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import type { AgentToolResult, ReadMark } from '@/ai/client'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { readConnection } from '@/sync/connection'
import { NodeClientStore } from './NodeClientStore'
import { NodeObsidianAdapter } from './NodeObsidianAdapter'
import { NodeObsidianExecutor } from './NodeObsidianExecutor'
import { obsidianDeviceName } from './obsidianDevice'
import { ensureNodeAgents, nodeToolRunners } from './nodeAgentTools'
import { nodeProviders } from './providers'
import { nodeAdvertisesMethod } from './advertisedMethods'
import {
  delegatedPermissionMode,
  ownerPermissionPatch,
  readToolPermissions,
} from './toolPermissions'
import { sessionOwnerMode } from './sessionOwnerMode'
import type { PermissionMode } from '@/ai/types'

const Config = z.object({
  max_delegate_depth: z.number().optional(),
  conversation: z.record(z.string(), z.unknown()).optional(),
  session_id: z.string(),
  vault_id: z.string(),
  agent_id: z.string(),
  revision: z.string(),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      inputSchema: z.record(z.string(), z.unknown()),
      mode: z.enum(['off', 'ask', 'auto']),
    })
  ),
})
const Configuration = z.object({
  configuration: Config,
  clients: z.array(
    z.object({
      platform: z.string(),
      label: z.string().optional(),
      revisions: z.record(z.string(), z.string()),
    })
  ),
})
const Invocation = z.object({
  invocation_id: z.string(),
  session_id: z.string(),
  run_id: z.string(),
  call_id: z.string(),
  installation_id: z.string(),
  vault_id: z.string(),
  agent_id: z.string(),
  revision: z.string(),
  tool_name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  state: z.string(),
  executor: z.object({ installation_id: z.string(), client_id: z.string() }).nullable(),
  created_at: z.number(),
  preview: z.record(z.string(), z.unknown()).optional(),
  cancel_requested: z.boolean().optional(),
  prepared_needs_approval: z.boolean().optional(),
  hosted: z.enum(['questions', 'delegate']).optional(),
  action: z.enum(['prepare', 'claim', 'waiting_approval', 'reconcile', 'cancel', 'hosted']),
})
const prefix = 'obsidian.tools.v1.'

/** Connection-scoped advertisement and session configuration; execution itself owns no timer. */
export class NodeObsidianTools {
  readonly questionnaires = shallowRef<Prompt[]>([])
  private stopQuestionnaires?: () => unknown
  private questionnaireGeneration = 0
  private readonly delegate: NodeObsidianDelegate
  readonly executor: NodeObsidianExecutor
  readonly vaultId: string
  readonly clientId: string
  private connected = false
  private disposed = false
  private busy?: Promise<void>
  private readonly adapters = new Map<string, NodeObsidianAdapter>()
  private readonly sessions = new Map<string, string>()
  private permissionSnapshots = false
  private readonly sessionModes = new Map<string, PermissionMode>()
  private readonly sessionRevisions = new Map<string, string>()
  private readonly snapshots = new Map<string, { fingerprint: string; revision: string }>()
  private readonly preparing = new Map<string, Promise<void>>()
  private readonly running = new Map<string, Promise<void>>()
  private lastDiscovery = 0
  private advertised = ''
  private readonly snapshotCache = new Map<
    string,
    { key: string; value: Promise<Awaited<ReturnType<NodeObsidianTools['buildSnapshot']>>> }
  >()
  private readonly configurations = new Map<string, z.infer<typeof Configuration>>()
  private readonly sessionLiveness = new Map<string, boolean>()
  private readonly cleanup: (() => void)[] = []
  private async forget(session: string): Promise<void> {
    this.sessions.delete(session)
    this.sessionModes.delete(session)
    this.sessionRevisions.delete(session)
    await this.store.transaction((state) => {
      delete state.obsidianSessions?.[session]
    })
  }
  constructor(
    readonly client: NodeClient,
    readonly store: NodeClientStore,
    readonly nodeId: string,
    readonly label: string
  ) {
    const app = GlobalStore.getInstance().app
    const invalidate = () => this.snapshotCache.clear()
    this.cleanup.push(AbeleConfig.getInstance().onSaved(invalidate))
    const skillsChanged = app.metadataCache.on?.('changed', invalidate)
    if (skillsChanged) this.cleanup.push(() => app.metadataCache.offref(skillsChanged))
    this.cleanup.push(
      client.onEvent?.((event) => {
        if (event.stream_id === 'catalog' && event.type === 'obsidian.tools.questionnaire')
          void this.refreshQuestionnaires().catch((error) =>
            console.debug('[Abele node] Questionnaire recovery pending', error)
          )
        const data = event.data as { revision?: string }
        const session = event.stream_id
        if (
          event.type === 'obsidian.tools.configured' &&
          data.revision !== this.sessionRevisions.get(session)
        ) {
          this.sessionRevisions.delete(session)
          this.configurations.delete(session)
        }
        if (['turn.started', 'input.accepted'].includes(event.type))
          this.sessionLiveness.set(session, true)
        if (['turn.completed', 'session.ended'].includes(event.type))
          this.sessionLiveness.set(session, false)
        if (event.type === 'session.updated') this.sessionLiveness.delete(session)
      }) ?? (() => {})
    )
    const localId = (key: string) => {
      const previous = app.loadLocalStorage(key) as string | undefined
      const id = previous || crypto.randomUUID()
      if (!previous) app.saveLocalStorage(key, id)
      return id
    }
    this.clientId = localId('abele-obsidian-tools-client')
    this.vaultId = readConnection(app).vaultId || localId('abele-obsidian-tools-vault')
    this.delegate = new NodeObsidianDelegate(client, store, this.clientId, async (id) => {
      const snapshot = await this.snapshot('delegate-target', id)
      return {
        vault_id: this.vaultId,
        agent_id: id,
        revision: snapshot.prefix + crypto.randomUUID(),
        tools: snapshot.tools,
        max_delegate_depth: snapshot.max_delegate_depth,
        conversation: snapshot.conversation,
      }
    })
    this.executor = new NodeObsidianExecutor({
      clientId: this.clientId,
      vaultId: this.vaultId,
      request: (method, params) => this.client.request(method, params),
      receipt: (id) => this.store.read((state) => state.obsidianExecutions?.[id]),
      save: (id, receipt) =>
        this.store.transaction((state) => {
          ;(state.obsidianExecutions ??= {})[id] = receipt
        }),
      hosted: (i, signal) => this.delegate.handle(i, signal),
      resolve: async (i) => {
        const configured = Configuration.parse(
          await this.client.request(prefix + 'configuration', { session_id: i.session_id })
        ).configuration
        if (configured.vault_id !== this.vaultId || configured.agent_id !== i.agent_id) return null
        const agent = AgentRegistry.getInstance().get(i.agent_id)
        if (!agent) return null
        const adapter = this.adapter(i.session_id, agent.id, configured.revision)
        const snapshot = await this.snapshot(i.session_id, agent.id)
        if (
          JSON.stringify(snapshot.tools) !== JSON.stringify(configured.tools) ||
          !configured.revision.startsWith(snapshot.prefix)
        )
          return null
        return adapter
      },
    })
  }
  private adapter(session: string, agent: string, revision: string) {
    const key = JSON.stringify([session, agent, revision])
    let adapter = this.adapters.get(key)
    if (!adapter) {
      adapter = new NodeObsidianAdapter(
        agent,
        revision,
        async (sessionId) =>
          this.store.read((state) => {
            const compactedAt = Math.max(
              0,
              ...(state.events[sessionId] ?? [])
                .filter(
                  (event) =>
                    event.type === 'compaction.completed' &&
                    (event.data as { result?: string }).result === 'success'
                )
                .map((event) => Date.parse(event.at))
            )
            return Object.values(state.obsidianExecutions ?? {}).flatMap((receipt) =>
              receipt.sessionId === sessionId &&
              receipt.state === 'succeeded' &&
              (receipt.at ?? 0) >= compactedAt &&
              Array.isArray(receipt.result.reads)
                ? (receipt.result.reads as ReadMark[])
                : []
            )
          }),
        async (sessionId) =>
          this.store.read((state) =>
            Object.values(state.obsidianExecutions ?? {})
              .filter(
                (receipt) =>
                  receipt.sessionId === sessionId &&
                  receipt.state === 'succeeded' &&
                  Array.isArray(receipt.result.content)
              )
              .map((receipt) => receipt.result as unknown as AgentToolResult)
          ),
        () => {
          const owner =
            sessionOwnerMode(this.nodeId, session) ??
            AgentRegistry.getInstance().get(agent)?.permissionMode ??
            'confirm-all'
          return delegatedPermissionMode(owner, this.sessionModes.get(session)) as PermissionMode
        }
      )
      this.adapters.set(key, adapter)
    }
    return adapter
  }
  private async snapshot(session: string, agentId: string) {
    const agent = AgentRegistry.getInstance().get(agentId)
    if (!agent) throw new Error('This node agent is no longer configured')
    if (
      this.permissionSnapshots &&
      !['delegate-target', 'delegation'].includes(session) &&
      this.sessionLiveness.get(session) !== false
    ) {
      try {
        const state = await this.client.sessionState(session)
        this.sessionLiveness.set(session, state.live === true)
        const policy = readToolPermissions(state)
        if (policy)
          this.sessionModes.set(
            session,
            policy.permission_mode === 'bypassPermissions' && policy.status === 'supported'
              ? 'allow-all'
              : policy.permission_mode === 'acceptEdits'
                ? 'allow-edit'
                : 'confirm-all'
          )
        else this.sessionModes.delete(session)
      } catch (error) {
        this.sessionModes.delete(session)
        console.debug('[Abele node] session permission snapshot unavailable', error)
      }
    }
    const key = JSON.stringify([
      agent,
      AbeleConfig.getInstance().ai.mcpServers,
      AbeleConfig.getInstance().ai.skillsFolder,
    ])
    const cached = this.snapshotCache.get(agentId)
    if (cached?.key === key) return cached.value
    const value = this.buildSnapshot(session, agentId)
    this.snapshotCache.set(agentId, { key, value })
    void value.catch(() => {
      if (this.snapshotCache.get(agentId)?.value === value) this.snapshotCache.delete(agentId)
    })
    return value
  }
  private async buildSnapshot(session: string, agentId: string) {
    const agent = AgentRegistry.getInstance().get(agentId)!
    const tools = this.adapter(session, agentId, 'snapshot').tools()
    const conversation = nodeConversation(agent)
    const max_delegate_depth = Math.min(3, Math.max(0, Math.floor(agent.maxDelegateDepth ?? 0)))
    const fingerprint = JSON.stringify(
      {
        tools,
        conversation,
        max_delegate_depth,
        permissionMode: agent.permissionMode,
        scope: agent.scope,
        fullVaultAccess: agent.fullVaultAccess,
        skillsMode: agent.skillsMode,
        skills: agent.skills,
        githubConnections: agent.githubConnections,
        mcpServers: AbeleConfig.getInstance().ai.mcpServers,
      },
      (_key, value: unknown) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
          : value
    )
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))
    const prefix =
      'v1_' +
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('') +
      '_'
    return { tools, fingerprint, prefix, conversation, max_delegate_depth }
  }
  async connectionChanged(description: unknown): Promise<void> {
    this.connected = false
    this.advertised = ''
    this.permissionSnapshots = !!ownerPermissionPatch(description).permission_mode
    this.sessionModes.clear()
    this.sessionLiveness.clear()
    this.configurations.clear()
    this.sessionRevisions.clear()
    if (!nodeAdvertisesMethod(this.client, prefix + 'advertise')) return
    const before = AgentRegistry.getInstance().list({
      includeUtility: true,
      includeNode: true,
    }).length
    ensureNodeAgents(
      this.nodeId,
      this.label,
      nodeProviders(description).map((provider) => provider.provider)
    )
    if (
      AgentRegistry.getInstance().list({ includeUtility: true, includeNode: true }).length !==
      before
    )
      await AbeleConfig.getInstance().saveSettings()
    const retained = await this.store.read((state) => state.obsidianSessions ?? {})
    for (const [session, agent] of Object.entries(retained)) this.sessions.set(session, agent)
    // Re-admit only snapshots this installation can actually execute for this vault.
    this.connected = true
    if (nodeAdvertisesMethod(this.client, prefix + 'questions.pending')) {
      await this.client.subscribe('catalog')
      await this.refreshQuestionnaires()
    }
    for (const [session, agent] of this.sessions) {
      if (!AgentRegistry.getInstance().get(agent)) {
        await this.forget(session)
        continue
      }
      try {
        await this.configure(session, agent)
      } catch (error) {
        if (['not_found', 'unauthorized'].includes((error as { code?: string }).code ?? ''))
          await this.forget(session)
        else throw error
      }
    }
    await this.discover()
    await this.advertise()
  }
  private async discover(): Promise<void> {
    this.lastDiscovery = Date.now()
    if (!this.client.listSessions) return
    let after: string | undefined
    while (!this.disposed) {
      const sessions = await this.client.listSessions(after)
      if (!sessions.length) break
      for (const session of sessions) {
        if (this.sessions.has(session.session_id)) continue
        let remote: z.infer<typeof Config>
        try {
          remote = Configuration.parse(
            await this.client.request(prefix + 'configuration', { session_id: session.session_id })
          ).configuration
        } catch (error) {
          if ((error as { code?: string }).code === 'obsidian_not_configured') continue
          throw error
        }
        if (remote.vault_id !== this.vaultId || !AgentRegistry.getInstance().get(remote.agent_id))
          continue
        const snapshot = await this.snapshot(session.session_id, remote.agent_id)
        if (
          JSON.stringify(snapshot.tools) !== JSON.stringify(remote.tools) ||
          !remote.revision.startsWith(snapshot.prefix)
        )
          continue
        this.snapshots.set(remote.agent_id, {
          fingerprint: snapshot.fingerprint,
          revision: remote.revision,
        })
        this.sessions.set(session.session_id, remote.agent_id)
        this.sessionRevisions.set(session.session_id, remote.revision)
        await this.store.transaction((state) => {
          ;(state.obsidianSessions ??= {})[session.session_id] = remote.agent_id
        })
      }
      const next = sessions.at(-1)!.session_id
      if (next === after) throw new Error('Node session discovery did not advance')
      after = next
    }
  }
  async ensureSession(session: string, provider: string): Promise<void> {
    if (!this.connected || this.disposed) return
    let pending = this.preparing.get(session)
    if (!pending) {
      pending = (async () => {
        if (!this.sessions.has(session)) await this.adoptSession(session)
        const bound = this.sessions.get(session)
        const agent = bound
          ? AgentRegistry.getInstance().get(bound)
          : ensureNodeAgents(this.nodeId, this.label, [provider])[0]
        if (!agent) return
        this.sessions.set(session, agent.id)
        await this.configure(session, agent.id)
        await this.advertise()
      })().finally(() => {
        this.preparing.delete(session)
      })
      this.preparing.set(session, pending)
    }
    return pending
  }
  async adoptSession(session: string): Promise<void> {
    if (!this.connected) return
    let remote: z.infer<typeof Config>
    try {
      remote = Configuration.parse(
        await this.client.request(prefix + 'configuration', { session_id: session })
      ).configuration
    } catch (error) {
      if (
        ['not_found', 'obsidian_not_configured'].includes((error as { code?: string }).code ?? '')
      )
        return
      throw error
    }
    if (remote.vault_id !== this.vaultId)
      throw new Error('This session uses Obsidian tools from another vault')
    if (!AgentRegistry.getInstance().get(remote.agent_id))
      throw new Error('The inherited Obsidian agent settings are not available on this device')
    this.sessions.set(session, remote.agent_id)
    await this.configure(session, remote.agent_id)
    await this.advertise()
  }
  private async configure(session: string, agentId: string) {
    const {
      tools,
      fingerprint,
      prefix: revisionPrefix,
      conversation,
      max_delegate_depth,
    } = await this.snapshot(session, agentId)
    const configured = this.snapshots.get(agentId)
    if (
      configured?.fingerprint === fingerprint &&
      this.sessionRevisions.get(session) === configured.revision &&
      this.configurations.has(session)
    )
      return
    let remote: z.infer<typeof Config> | undefined
    try {
      const response = Configuration.parse(
        await this.client.request(prefix + 'configuration', { session_id: session })
      )
      this.configurations.set(session, response)
      remote = response.configuration
    } catch (error) {
      if ((error as { code?: string }).code !== 'obsidian_not_configured') throw error
    }
    if (remote && remote.vault_id !== this.vaultId)
      throw new Error('This session uses Obsidian tools from another vault')
    const same =
      remote?.agent_id === agentId &&
      JSON.stringify(remote.tools) === JSON.stringify(tools) &&
      remote.revision.startsWith(revisionPrefix)
    const known = this.snapshots.get(agentId)
    let revision =
      known?.fingerprint === fingerprint
        ? known.revision
        : same
          ? remote.revision
          : revisionPrefix + crypto.randomUUID()
    if (!same || remote.revision !== revision) {
      const send = () =>
        this.client.request(prefix + 'configure', {
          session_id: session,
          vault_id: this.vaultId,
          agent_id: agentId,
          revision,
          tools,
          conversation,
          max_delegate_depth,
          ...(remote ? { expected_revision: remote.revision } : {}),
        })
      try {
        await send()
      } catch (error) {
        if ((error as { code?: string }).code !== 'revision_conflict') throw error
        // Another session may have used this same agent revision before. Never reuse its
        // historical revision; refresh the writer fence and mint a fresh whole snapshot.
        remote = Configuration.parse(
          await this.client.request(prefix + 'configuration', { session_id: session })
        ).configuration
        if (remote.vault_id !== this.vaultId) throw new Error('This session uses another vault')
        revision = revisionPrefix + crypto.randomUUID()
        await send()
      }
    }
    this.snapshots.set(agentId, { fingerprint, revision })
    this.sessions.set(session, agentId)
    this.sessionRevisions.set(session, revision)
    const previous = this.configurations.get(session)
    this.configurations.set(session, {
      clients: previous?.clients ?? [],
      configuration: {
        session_id: session,
        vault_id: this.vaultId,
        agent_id: agentId,
        revision,
        tools,
        conversation,
        max_delegate_depth,
      },
    })
    await this.store.transaction((state) => {
      ;(state.obsidianSessions ??= {})[session] = agentId
    })
    this.adapter(session, agentId, revision)
  }
  private async advertise() {
    const advertisement = {
      client_id: this.clientId,
      vault_id: this.vaultId,
      platform: Platform.isMobile ? 'mobile' : 'desktop',
      label: obsidianDeviceName(),
      revisions: Object.fromEntries(
        [...this.snapshots].map(([agent, snapshot]) => [agent, snapshot.revision])
      ),
    }
    const signature = JSON.stringify(advertisement)
    if (this.advertised === signature) return
    await this.client.request(prefix + 'advertise', advertisement)
    this.advertised = signature
  }
  tick(): Promise<void> {
    if (!this.connected || this.disposed) return Promise.resolve()
    return (this.busy ??= this.poll().finally(() => {
      this.busy = undefined
    }))
  }
  private async poll() {
    if (Date.now() - this.lastDiscovery > 30000) await this.discover()
    for (const [session, agent] of this.sessions) {
      const current = await this.snapshot(session, agent)
      if (
        this.snapshots.get(agent)?.fingerprint !== current.fingerprint ||
        this.sessionRevisions.get(session) !== this.snapshots.get(agent)?.revision
      )
        await this.configure(session, agent)
    }
    await this.advertise()
    const calls = z
      .array(Invocation)
      .parse(await this.client.request(prefix + 'poll', { client_id: this.clientId }))
    for (const invocation of calls) {
      // Polling stays live while a handler waits, so Stop can still abort it.
      const task = this.executor.accept({ ...invocation, executor: invocation.executor ?? null })
      if (!this.running.has(invocation.invocation_id)) {
        this.running.set(invocation.invocation_id, task)
        void task
          .catch((error: unknown) =>
            console.debug('[Abele node] Obsidian tool pending reconciliation', error)
          )
          .finally(() => this.running.delete(invocation.invocation_id))
      }
    }
    const first = this.sessions.keys().next().value as string | undefined
    const configured = first ? this.configurations.get(first) : undefined
    if (configured) {
      const { clients, configuration } = configured
      const eligible = clients
        .filter((client) => client.revisions[configuration.agent_id] === configuration.revision)
        .sort((a, b) => Number(b.platform === 'desktop') - Number(a.platform === 'desktop'))
      nodeToolRunners[this.nodeId] = eligible.length
        ? {
            state: 'device',
            device:
              eligible[0].label ||
              (eligible[0].platform === 'desktop' ? 'Desktop' : 'Mobile device'),
          }
        : { state: 'none' }
    } else
      nodeToolRunners[this.nodeId] = {
        state: 'device',
        device: obsidianDeviceName(),
      }
  }
  async delegationSnapshot(
    parent: string,
    provider: string
  ): Promise<ObsidianToolsSnapshot | undefined> {
    if (!this.connected) return undefined
    let remote: z.infer<typeof Config> | undefined
    try {
      remote = Configuration.parse(
        await this.client.request(prefix + 'configuration', { session_id: parent })
      ).configuration
    } catch (error) {
      if (
        !['not_found', 'obsidian_not_configured'].includes((error as { code?: string }).code ?? '')
      )
        throw error
    }
    if (remote) {
      if (remote.vault_id !== this.vaultId)
        throw new Error('The delegation parent uses another vault')
      await this.configure(parent, remote.agent_id)
      const current = Configuration.parse(
        await this.client.request(prefix + 'configuration', { session_id: parent })
      ).configuration
      await this.advertise()
      const { session_id: _session, ...snapshot } = current
      return snapshot
    }
    const agent = ensureNodeAgents(this.nodeId, this.label, [provider])[0]
    if (!agent) return undefined
    const current = await this.snapshot('delegation', agent.id)
    const previous = this.snapshots.get(agent.id)
    const revision =
      previous?.fingerprint === current.fingerprint
        ? previous.revision
        : current.prefix + crypto.randomUUID()
    this.snapshots.set(agent.id, { fingerprint: current.fingerprint, revision })
    await this.advertise()
    return {
      vault_id: this.vaultId,
      agent_id: agent.id,
      revision,
      tools: current.tools,
      conversation: current.conversation,
      max_delegate_depth: current.max_delegate_depth,
    }
  }
  async refreshQuestionnaires(): Promise<void> {
    const generation = ++this.questionnaireGeneration
    const prompts: Prompt[] = []
    let after: string | undefined
    for (;;) {
      const page = await this.client.pendingQuestionnaires(this.vaultId, after)
      prompts.push(...page.map((prompt) => PromptSchema.parse(prompt)))
      if (!page.length) break
      const next = page.at(-1)!.prompt_id
      if (next === after) throw new Error('Questionnaire recovery did not advance')
      after = next
    }
    if (generation === this.questionnaireGeneration && !this.disposed)
      this.questionnaires.value = prompts
  }
  async answerQuestionnaire(prompt: Prompt, answers: QuestionnaireAnswer[] | null): Promise<void> {
    await this.client.answerQuestionnaire(prompt, answers)
    await this.refreshQuestionnaires()
  }
  disconnected(): void {
    this.connected = false
    this.advertised = ''
    nodeToolRunners[this.nodeId] = { state: 'none' }
  }
  async destroy(): Promise<void> {
    this.disposed = true
    for (const stop of this.cleanup) stop()
    this.cleanup.length = 0
    this.stopQuestionnaires?.()
    this.disconnected()
    await this.executor.destroy()
    for (const adapter of this.adapters.values()) adapter.destroy()
    this.adapters.clear()
  }
}
