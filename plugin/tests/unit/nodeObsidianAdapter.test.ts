import { afterEach, beforeEach, expect, it } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { NodeObsidianAdapter } from '@/node/NodeObsidianAdapter'
import type { ObsidianInvocation } from '@/node/NodeObsidianExecutor'

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

// BUG: the node executor contract has no owner-question creation/result transport.
// The ordinary handler requires a conversation host; an active vault chat is not that host.
it.fails('executes an enabled ordinary questionnaire in its own node conversation', async () => {
  AgentRegistry.getInstance().update(agentId, { toolModes: { questions: 'auto' } })
  const invocation = call('questions', {
    questions: [{ question: 'Choose a sample option', options: ['First', 'Second'] }],
  })
  await expect(
    adapter.execute(invocation, true, new AbortController().signal)
  ).resolves.toMatchObject({ content: expect.any(Array) })
})

// BUG: local delegation also needs a conversation host, including its depth and root budget.
// A missing target proves host admission without starting any provider executable.
it.fails('admits an enabled local delegation through the ordinary target resolver', async () => {
  AgentRegistry.getInstance().update(agentId, { toolModes: { delegate: 'auto' } })
  await expect(
    adapter.execute(
      call('delegate', { agent: 'Missing sample agent', task: 'A sample task' }),
      true,
      new AbortController().signal
    )
  ).rejects.toThrow(/not found/i)
})
