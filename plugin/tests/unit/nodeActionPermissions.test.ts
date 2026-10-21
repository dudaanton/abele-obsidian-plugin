import { beforeEach, expect, it } from 'vitest'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { createAgent } from '@/ai/agents/types'
import { DelegationTaskInputSchema, DelegationStorageSchema } from '@/node/delegation'
import { ChatSession } from '@/ai/ChatSession'
import { agentChoices, nodeProviders } from '@/node/providers'
import {
  nodeActionModes,
  localNodeActionModes,
  saveLocalNodeActionModes,
  requireNodeActionPermission,
} from '@/ai/nodeActionPermissions'
import { ref } from 'vue'
import { useVault } from '../helpers/testEnv'
beforeEach(() => {
  useVault([])
})
const actions = [
  'node_delegate',
  'node_delegations',
  'node_delegation_send',
  'node_delegation_status',
  'node_delegation_cancel',
  'node_command_run',
  'node_command_status',
  'node_command_cancel',
  'node_git_integrate',
]
it('defaults every node action off', () => {
  const agent = createAgent()
  for (const name of actions) {
    expect(DEFAULT_AI_SETTINGS.toolModes[name]).toBe('off')
    expect(agent.toolModes[name]).toBe('off')
  }
})
it('requires approval for Ask actions and refuses Off even with an old approval', () => {
  const session = { getToolMode: () => 'ask' } as unknown as ChatSession
  for (const name of actions) {
    if (['node_delegations', 'node_delegation_status', 'node_command_status'].includes(name))
      expect(() => requireNodeActionPermission(session, name)).not.toThrow()
    else expect(() => requireNodeActionPermission(session, name)).toThrow(/approval/)
    expect(() => requireNodeActionPermission(session, name, true)).not.toThrow()
  }
  session.getToolMode = () => 'off'
  for (const name of actions)
    expect(() => requireNodeActionPermission(session, name, true)).toThrow(/off/)
})
it('asks before every mutating node action in ask mode, even in bypass', () => {
  const session = {
    permissionMode: { value: 'allow-all' },
    getToolMode: () => 'ask',
  } as unknown as ChatSession
  for (const name of actions.filter(
    (n) => !['node_delegations', 'node_delegation_status', 'node_command_status'].includes(n)
  ))
    expect(ChatSession.prototype.needsApproval.call(session, name)).toBe(true)
})
it('never offers the test provider', () => {
  expect(nodeProviders({ providers: [{ provider: 'fake', available: true }] })).toEqual([])
  expect(
    agentChoices([{ provider: 'fake', available: true, capabilities: {} }]).some(
      (p) => p.provider === 'fake'
    )
  ).toBe(false)
})
it('rejects new test-provider work while retaining old task records', () => {
  const input = {
    task_key: 'sample-task',
    provider: 'fake',
    title: 'Sample task',
    text: 'Sample work',
  }
  expect(DelegationTaskInputSchema.safeParse(input).success).toBe(false)
  expect(
    DelegationStorageSchema.safeParse({
      tasks: {
        sample: {
          parentId: 'sample-parent',
          input,
          request: {
            provider: 'fake',
            title: 'Sample task',
            text: 'Sample work',
            delegation_key: 'sample-key',
          },
        },
      },
    }).success
  ).toBe(true)
})
it('ignores imported chat and folder grants, and persists a local choice per agent', () => {
  expect(nodeActionModes({ node_delegate: 'auto' }, {}, {}).node_delegate).toBe('off')
  saveLocalNodeActionModes('sample-chat', 'sample-agent', { node_delegate: 'ask' })
  expect(localNodeActionModes('sample-chat', 'sample-agent').node_delegate).toBe('ask')
  expect(localNodeActionModes('sample-chat', 'other-agent').node_delegate).toBeUndefined()
  expect(nodeActionModes({}, {}, { node_delegate: 'ask' }).node_delegate).toBe('ask')
})
it('keeps an explicit scope removal across agent switches and clearing', () => {
  const session = {
    agentId: ref('first'),
    overrides: ref({ nodeScope: [] }),
    syncScopeFromAgent() {},
    isOverridden: () => true,
  } as unknown as ChatSession
  ChatSession.prototype.bindAgent.call(session, 'second')
  expect(session.overrides.value.nodeScope).toEqual([])
  ChatSession.prototype.clearOverride.call(session, 'nodeScope')
  expect(session.overrides.value.nodeScope).toEqual([])
})
