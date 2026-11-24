import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ensureNodeAgents } from '@/node/nodeAgentTools'
import { NodeObsidianTools } from '@/node/NodeObsidianTools'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeObsidianAdapter } from '@/node/NodeObsidianAdapter'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryClientStore, NodeClient } from '@abele/node-client'

beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()))
afterEach(() => vi.unstubAllGlobals())

it.each(['prepare-pending', 'prepare-resolved', 'execute-pending'] as const)(
  'isolates each operation from another owner refresh: %s',
  async (scenario) => {
    const app = Object.assign(useVault([]), { appId: 'sample-concurrent-owner' })
    AgentRegistry.destroy()
    AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
    const agent = ensureNodeAgents('sample-node', 'Sample node', ['fake'])[0]!
    agent.permissionMode = 'confirm-all'
    agent.toolModes.create = 'ask'
    const store = new NodeClientStore('sample-concurrent-' + crypto.randomUUID(), new IDBFactory())
    const client = new NodeClient(
      { url: 'ws://127.0.0.1:1/channel', profile: 'local-token-v1', token: 'sample-token' },
      new MemoryClientStore()
    )
    const runtime = new NodeObsidianTools(client, store, 'sample-node', 'Sample node')
    const { DeviceIntentStore } = await import('@/services/DeviceIntentStore')
    let resumeHistory!: () => void
    let historyReached!: () => void
    const reached = new Promise<void>((resolve) => {
      historyReached = resolve
    })
    const history = new Promise<void>((resolve) => {
      resumeHistory = resolve
    })
    let resumeRefresh!: (value: unknown) => void
    const refreshValue = new Promise<unknown>((resolve) => {
      resumeRefresh = resolve
    })
    let refreshReached!: () => void
    const refreshing = new Promise<void>((resolve) => {
      refreshReached = resolve
    })
    let second = false
    const read = vi.spyOn(DeviceIntentStore.prototype, 'read').mockImplementation(async () => {
      if (!second) return 'confirm-all'
      refreshReached()
      return refreshValue
    })
    const adapter = (
      runtime as unknown as {
        adapter(session: string, agent: string, revision: string): NodeObsidianAdapter
      }
    ).adapter('sample-session', agent.id, 'sample-revision')
    Object.assign(adapter, {
      previousResults: async () => {
        historyReached()
        await history
        return []
      },
    })
    const invocation = {
      invocation_id: 'sample-invocation',
      session_id: 'sample-session',
      run_id: 'sample-run',
      call_id: 'sample-call',
      installation_id: 'sample-installation',
      vault_id: 'sample-vault',
      agent_id: agent.id,
      revision: 'sample-revision',
      tool_name: 'create',
      arguments: { path: 'sample-created.md', content: 'Sample content' },
      state: 'ready' as const,
      executor: null,
      created_at: 1,
      action: 'claim' as const,
    }
    const executing = scenario.startsWith('execute')
    const operation = executing
      ? adapter.execute(invocation, true, new AbortController().signal)
      : adapter.prepare(invocation)
    // Observe rejection immediately while deliberately holding both continuations.
    void operation.catch(() => {})
    let competing: Promise<unknown> | undefined
    try {
      await reached
      second = true
      competing = adapter.refreshPermissionMode()
      await refreshing
      if (scenario.endsWith('resolved')) {
        resumeRefresh('allow-all')
        await competing
      }
      resumeHistory()
      if (executing) {
        await expect(operation).resolves.toMatchObject({ details: { path: 'sample-created.md' } })
        expect(app.vault.getAbstractFileByPath('sample-created.md')).not.toBeNull()
      } else {
        await expect(operation).resolves.toMatchObject({ needsApproval: true })
      }
    } finally {
      resumeHistory()
      resumeRefresh('allow-all')
      await Promise.allSettled([operation, ...(competing ? [competing] : [])])
      read.mockRestore()
      await runtime.destroy()
      store.close()
    }
  }
)
