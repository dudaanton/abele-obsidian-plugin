import { MemoryClientStore } from '@abele/node-client'
import { NodePathMutations } from '@/node/NodePathMutations'
import { beforeEach, expect, it, vi } from 'vitest'
import { createAgent } from '@/ai/agents/types'
import type { AgentDefinition } from '@/ai/agents/types'
import { nodeAgentSessionSettings, rememberNodeAgentEffort } from '@/node/nodeAgentTools'

const { agents } = vi.hoisted(() => ({ agents: new Map<string, AgentDefinition>() }))
vi.mock('@/ai/agents/AgentRegistry', () => ({
  AgentRegistry: {
    getInstance: () => ({
      get: (id: string) => agents.get(id),
      create: (data: Partial<AgentDefinition>) => {
        const agent = createAgent(data)
        agents.set(agent.id, agent)
        return agent
      },
      update: (id: string, patch: Partial<AgentDefinition>) =>
        Object.assign(agents.get(id)!, patch),
    }),
  },
}))
beforeEach(() => agents.clear())
it('leaves the provider default unset until an explicit choice and isolates node/provider pairs', () => {
  expect(nodeAgentSessionSettings('sample-node', 'codex')).toEqual({})
  rememberNodeAgentEffort('sample-node', 'codex', 'high')
  expect(nodeAgentSessionSettings('sample-node', 'codex')).toEqual({ effort: 'high' })
  expect(nodeAgentSessionSettings('another-node', 'codex')).toEqual({})
  expect(nodeAgentSessionSettings('sample-node', 'claude')).toEqual({})
  const alreadyCreated = nodeAgentSessionSettings('sample-node', 'codex')
  rememberNodeAgentEffort('sample-node', 'codex', 'low')
  expect(alreadyCreated).toEqual({ effort: 'high' })
  expect(nodeAgentSessionSettings('sample-node', 'codex')).toEqual({ effort: 'low' })
})
it('retains the preference across a stored agent reload', () => {
  rememberNodeAgentEffort('sample-node', 'codex', 'xhigh')
  const stored = JSON.parse(JSON.stringify([...agents]))
  agents.clear()
  for (const [id, value] of stored) agents.set(id, createAgent(value))
  expect(nodeAgentSessionSettings('sample-node', 'codex')).toEqual({ effort: 'xhigh' })
})

it('passes the remembered effort at session creation and omits an unchosen effort', async () => {
  const createSession = vi.fn(async (_params: unknown, _id: string) => ({
    session_id: 'sample-session',
    title: 'Sample',
  }))
  const mutations = new NodePathMutations({
    store: new MemoryClientStore(),
    nodePath: { createSession } as never,
  })
  const target = {
    nodeId: 'sample-node',
    registrationId: 'sample-registration',
    projectId: 'sample-project',
    kind: 'worktree' as const,
    id: 'sample-tree',
  }
  await mutations.session(target, 'Sample', 'codex')
  expect(createSession.mock.calls[0][0]).toMatchObject({ provider: 'codex', settings: {} })
  rememberNodeAgentEffort('sample-node', 'codex', 'high')
  await mutations.session(target, 'Sample', 'codex')
  expect(createSession.mock.calls[1][0]).toMatchObject({
    provider: 'codex',
    settings: { effort: 'high' },
  })
})
