import { afterEach, beforeEach, expect, it } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { NodeObsidianAdapter } from '@/node/NodeObsidianAdapter'
import type { ObsidianInvocation } from '@/node/NodeObsidianExecutor'
import { NodeObsidianExecutor } from '@/node/NodeObsidianExecutor'
import { NodeObsidianDelegate } from '@/node/NodeObsidianDelegate'
import { NodeClientStore } from '@/node/NodeClientStore'
import { IDBFactory } from 'fake-indexeddb'
import type { NodeClient } from '@abele/node-client'

let adapter: NodeObsidianAdapter
let agentId: string
beforeEach(() => {
  useVault([{ path: 'sample.md', content: 'Before' }])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  agentId = AgentRegistry.getInstance().create({ fullVaultAccess: true }).id
  adapter = new NodeObsidianAdapter(agentId, 'revision-1', async () => [])
})
afterEach(() => adapter.destroy())
const call = (tool_name: string, args: Record<string, unknown>): ObsidianInvocation => ({
  invocation_id: 'sample-invocation',
  session_id: 'sample-session',
  run_id: 'sample-run',
  call_id: 'sample-call',
  installation_id: 'sample-installation',
  vault_id: 'sample-vault',
  agent_id: agentId,
  revision: 'revision-1',
  tool_name,
  arguments: args,
  state: 'ready',
  executor: null,
  created_at: 1,
  action: 'claim',
})
it('exports ordinary schemas and effective core permissions, including default-Off feature tools', () => {
  const snapshot = adapter.tools()
  expect(snapshot.find((tool) => tool.name === 'read')?.mode).toBe('auto')
  expect(snapshot.find((tool) => tool.name === 'create')?.mode).toBe('ask')
  expect(snapshot.find((tool) => tool.name === 'fetch')?.mode).toBe('off')
  expect(snapshot.find((tool) => tool.name === 'create')?.inputSchema).toMatchObject({
    required: ['path', 'content'],
  })
})
it('executes ordinary create and read handlers and retains their structured results', async () => {
  const invocation = call('create', { path: 'created.md', content: 'Created text' })
  const prepared = await adapter.prepare(invocation)
  expect(prepared.preview).toMatchObject({ path: 'created.md', content: 'Created text' })
  const result = await adapter.execute(
    { ...invocation, preview: prepared.preview },
    false,
    new AbortController().signal
  )
  expect(result).toMatchObject({
    details: { diff: { old: '', new: 'Created text' }, path: 'created.md' },
  })
})
it('rejects disabled tools even in bypass and rechecks source before an edit', async () => {
  const disabled = call('fetch', { url: 'https://example.invalid' })
  await expect(adapter.execute(disabled, true, new AbortController().signal)).rejects.toThrow(
    /disabled/i
  )
  const edit = call('edit', { path: 'sample.md', old_string: 'Before', new_string: 'After' })
  const prepared = await adapter.prepare(edit)
  await expect(
    adapter.execute({ ...edit, preview: prepared.preview }, false, new AbortController().signal)
  ).rejects.toThrow(/read first/i)
})

it('executes an enabled ordinary questionnaire in its own node conversation', async () => {
  AgentRegistry.getInstance().update(agentId, { toolModes: { questions: 'auto' } })
  const invocation = call('questions', {
    questions: [{ question: 'Choose a sample option', options: ['First', 'Second'] }],
  })
  const methods: string[] = []
  const prepared = await adapter.prepare(invocation)
  const executor = new NodeObsidianExecutor({
    clientId: 'sample-client',
    vaultId: invocation.vault_id,
    request: async (method) => {
      methods.push(method)
      return { execute: true }
    },
    save: async () => {},
    receipt: async () => undefined,
    resolve: async () => adapter,
  })
  await executor.accept({
    ...invocation,
    preview: prepared.preview,
    executor: { installation_id: 'sample-installation', client_id: 'sample-client' },
  })
  expect(methods).toContain('obsidian.tools.v1.questions.open')
  expect(methods).not.toContain('obsidian.tools.v1.complete')
  await executor.destroy()
})

it('admits an enabled local delegation through the ordinary target resolver', async () => {
  AgentRegistry.getInstance().update(agentId, { toolModes: { delegate: 'auto' } })
  const store = new NodeClientStore('sample-host', new IDBFactory())
  const host = new NodeObsidianDelegate(
    { request: async () => ({ runs: [] }) } as unknown as NodeClient,
    store,
    'sample-client',
    async () => {
      throw new Error('Must resolve a target first')
    }
  )
  try {
    await expect(
      host.handle(
        call('delegate', { agent: 'Missing sample agent', task: 'A sample task' }),
        new AbortController().signal
      )
    ).rejects.toThrow(/not found/i)
  } finally {
    store.close()
  }
})
