import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { ChatSession } from '@/ai/ChatSession'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { nodeScopeEntries } from '@/ai/nodeScope'
import { ordinaryNeedsApproval } from '@/ai/ordinaryToolPolicy'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
it('saves all effective access into independent agent defaults', async () => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({ name: 'Sample helper' })
  const save = vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue()
  const nodes = [{ kind: 'node' as const, node_id: 'sample-node', access: 'run' as const }]
  const scope = [{ type: 'folder' as const, path: 'Examples' }]
  const session = {
    agent: ref(agent),
    scopeResolver: { entries: ref(scope), fullVaultAccess: ref(false) },
    effectiveNodeScope: nodes,
    permissionMode: ref('allow-all'),
    toolModes: ref({ web_search: 'ask' }),
    githubConnections: ref({}),
  }
  await ChatSession.prototype.saveAccessAsAgentDefault.call(session as never)
  expect(agent.scope).toEqual(scope)
  expect(agent.permissionMode).toBe('allow-all')
  expect(agent.toolModes).toEqual({ web_search: 'ask' })
  expect(
    nodeScopeEntries({
      agent: ref(agent),
      overrides: ref({}),
      conversationVersion: ref(0),
      nodeScopeIdentity: 'new-chat',
    })
  ).toEqual(nodes)
  nodes.length = 0
  scope.length = 0
  expect(agent.nodeScope).toHaveLength(1)
  expect(agent.scope).toHaveLength(1)
  expect(save).toHaveBeenCalledOnce()
  save.mockRestore()
})
it('uses Delegate for node instructions despite a legacy auto switch in every chat mode', () => {
  const policy = {
    permissionMode: 'confirm-all',
    toolModes: { node_delegate: 'auto' },
    getToolMode: (name: string) => (name === 'delegate' ? 'ask' : 'auto'),
    outOfScopePath: () => null,
    bookAnchored: false,
    skillNeedsApproval: () => false,
  }
  for (const permissionMode of ['confirm-all', 'allow-edit', 'allow-all']) {
    policy.permissionMode = permissionMode
    for (const delegate of ['off', 'ask', 'auto']) {
      policy.getToolMode = (name) => (name === 'delegate' ? delegate : 'auto')
      for (const tool of ['node_delegate', 'node_delegation_send'])
        expect(ordinaryNeedsApproval(policy as never, tool)).toBe(
          ordinaryNeedsApproval(policy as never, 'delegate')
        )
    }
  }
})

it('migrates legacy agent defaults once and preserves a later downgrade', () => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample legacy helper',
    nodeScope: [{ kind: 'node', node_id: 'sample-node', access: 'edit' }],
    toolModes: { node_delegate: 'ask' },
  })
  delete agent.nodeAccessVersion
  expect(registry.get(agent.id)?.nodeScope?.[0].access).toBe('run')
  agent.nodeScope![0].access = 'edit'
  expect(registry.get(agent.id)?.nodeScope?.[0].access).toBe('edit')
})

it('keeps a duplicated agent node default independent', () => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  const registry = AgentRegistry.getInstance()
  const source = registry.create({
    name: 'Sample original',
    nodeScope: [
      {
        kind: 'target',
        node_id: 'sample-node',
        project_id: 'sample-project',
        target: { kind: 'worktree', worktree_id: 'sample-tree' },
        access: 'run',
      },
    ],
  })
  const copy = registry.duplicate(source.id)!
  copy.nodeScope![0].access = 'read'
  expect(source.nodeScope![0].access).toBe('run')
})
