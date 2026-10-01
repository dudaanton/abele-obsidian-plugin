import { afterEach, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import type { AgentTool } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { DelegateRun } from '@/ai/DelegateRun'
import { deferred } from '../helpers/deferred'

const sessions: ChatSession[] = []
afterEach(() => {
  sessions.forEach((session) => session.destroy())
  sessions.length = 0
  ChatService.getInstance().destroy()
  vi.restoreAllMocks()
})

it('asks in the executing chat even when another chat is in front', async () => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.applySettings(undefined)
  config.ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample helper',
    toolModes: { questions: 'auto' },
    permissionMode: 'allow-all',
  })
  registry.setDefault(agent.id)
  const service = ChatService.getInstance()
  const owner = new ChatSession(service)
  const visible = new ChatSession(service)
  sessions.push(owner, visible)
  ;(service as unknown as { sessions: Map<string, ChatSession> }).sessions.set(visible.id, visible)
  service.activeTabId.value = visible.id
  const asked = vi.spyOn(owner, 'askQuestions').mockResolvedValue(['blue'])
  const other = vi.spyOn(visible, 'askQuestions').mockResolvedValue(['red'])
  const tools = (owner as unknown as { getTools(): AgentTool[] }).getTools()
  const question = tools.find((tool) => tool.name === 'questions')!
  await question.execute('sample-question', {
    questions: [{ question: 'Colour?', options: ['blue', 'red'] }],
  })
  expect(asked).toHaveBeenCalledOnce()
  expect(other).not.toHaveBeenCalled()
})

it('keeps a delegation attached to its caller while a second tool is running', async () => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.applySettings(undefined)
  config.ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample coordinator',
    toolModes: { delegate: 'auto' },
    maxDelegateDepth: 1,
  })
  registry.setDefault(agent.id)
  const target = registry.create({ name: 'Sample worker' })
  const service = ChatService.getInstance()
  const owner = new ChatSession(service)
  const other = new ChatSession(service)
  sessions.push(owner, other)
  const parents: string[] = []
  vi.spyOn(DelegateRun.prototype, 'run').mockImplementation(async function () {
    parents.push((this as unknown as { options: { parent: ChatSession } }).options.parent.id)
    return {
      runId: 'sample-run',
      branches: [{ item: 'sample', status: 'done', messages: [], result: 'Done' }],
    }
  })
  const tools = (owner as unknown as { getTools(): AgentTool[] }).getTools()
  const gate = deferred<void>()
  const otherTools = (
    other as unknown as { wrapToolsForSession(tools: AgentTool[]): AgentTool[] }
  ).wrapToolsForSession([
    {
      name: 'sample',
      label: 'Sample',
      description: '',
      parameters: {},
      execute: async () => {
        await gate.promise
        return { content: [] }
      },
    },
  ])
  const delegated = tools
    .find((tool) => tool.name === 'delegate')!
    .execute('sample-call', { agent: target.id, task: 'Read sample' })
  const concurrent = otherTools[0].execute('other-call', {})
  try {
    await delegated
    expect(parents).toEqual([owner.id])
  } finally {
    gate.resolve()
    await concurrent
  }
})
