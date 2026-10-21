import { expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ensureNodeAgents } from '@/node/nodeAgentTools'
import { NodeObsidianTools } from '@/node/NodeObsidianTools'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'
import type { NodeClient } from '@abele/node-client'
import { ChannelError } from '@abele/channel-protocol'
import { ObsidianToolsSnapshotSchema } from '@abele/node-protocol'

it('keeps node agent tool settings in ordinary transferable agent definitions without offering them as vault models', () => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  const agents = ensureNodeAgents('sample-node', 'Sample node', ['claude', 'pi', 'codex'])
  expect(agents).toHaveLength(3)
  expect(AgentRegistry.getInstance().list({ includeNode: true, includeUtility: true })).toEqual(
    expect.arrayContaining(agents)
  )
  expect(
    AgentRegistry.getInstance()
      .list({ includeUtility: true })
      .some((agent) => agent.node)
  ).toBe(false)
  agents[0].toolModes.create = 'off'
  expect(ensureNodeAgents('sample-node', 'Sample node', ['claude'])[0].toolModes.create).toBe('off')
})

it('configures ordinary schemas before execution, advertises on reconnect and completes a fake-node call once', async () => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue()
  const configs = new Map<string, Record<string, unknown>>()
  let calls: unknown[] = []
  const request = vi.fn(async (method: string, params: Record<string, unknown>) => {
    if (method.endsWith('.configuration')) {
      const configuration = configs.get(String(params.session_id))
      if (!configuration) throw new ChannelError('obsidian_not_configured')
      return { configuration, clients: [] }
    }
    if (method.endsWith('.configure')) {
      const { expected_revision: _expected, ...config } = params
      configs.set(String(params.session_id), config)
      return config
    }
    if (method.endsWith('.poll')) return calls
    if (method.endsWith('.claim')) return { execute: true, bypass: true }
    return {}
  })
  const client = {
    request,
    channel: { channel: { welcome: { methods: ['obsidian.tools.v1.advertise'] } } },
  } as unknown as NodeClient
  const store = new NodeClientStore('sample-tool-runtime', new IDBFactory())
  const runtime = new NodeObsidianTools(client, store, 'sample-node', 'Sample node')
  try {
    await runtime.connectionChanged({ providers: [{ provider: 'fake', available: true }] })
    await runtime.ensureSession('sample-session', 'fake')
    await runtime.ensureSession('sample-second-session', 'fake')
    const configuration = configs.get('sample-session')!
    const { session_id: _sessionId, ...wireSnapshot } = configuration
    expect(ObsidianToolsSnapshotSchema.safeParse(wireSnapshot).success).toBe(true)
    const agent = AgentRegistry.getInstance().get(String(configuration.agent_id))!
    agent.fullVaultAccess = !agent.fullVaultAccess
    await runtime.ensureSession('sample-session', 'fake')
    expect(configs.get('sample-session')!.revision).not.toBe(configuration.revision)
    await runtime.tick()
    expect(configs.get('sample-second-session')!.revision).toBe(
      configs.get('sample-session')!.revision
    )
    Object.assign(configuration, configs.get('sample-session')!)
    expect(configuration.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'create', mode: 'ask' })])
    )
    calls = [
      {
        ...configuration,
        invocation_id: 'sample-invocation',
        run_id: 'sample-run',
        call_id: 'sample-call',
        installation_id: 'sample-installation',
        tool_name: 'create',
        arguments: { path: 'created.md', content: 'Created text' },
        state: 'preparing',
        executor: { installation_id: 'sample-installation', client_id: runtime.clientId },
        created_at: 1,
        action: 'prepare',
      },
    ]
    await runtime.tick()
    for (
      let i = 0;
      i < 30 && !request.mock.calls.some(([method]) => method.endsWith('.prepare'));
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 10))
    const prepared = request.mock.calls.find(([method]) => method.endsWith('.prepare'))![1]
    calls = [
      {
        ...(calls[0] as Record<string, unknown>),
        state: 'ready',
        action: 'claim',
        preview: prepared.preview,
        prepared_needs_approval: prepared.needs_approval,
      },
    ]
    await runtime.tick()
    for (
      let i = 0;
      i < 30 && !request.mock.calls.some(([method]) => method.endsWith('.complete'));
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 10))
    expect(request.mock.calls.find(([method]) => method.endsWith('.complete'))?.[1]).toMatchObject({
      state: 'succeeded',
    })
    calls = [{ ...(calls[0] as Record<string, unknown>), state: 'executing', action: 'reconcile' }]
    await runtime.tick()
    await runtime.destroy()
    expect(
      (await store.read((state) => state.obsidianExecutions?.['sample-invocation']))?.state
    ).toBe('succeeded')
  } finally {
    await runtime.destroy()
    store.close()
    vi.restoreAllMocks()
  }
})
