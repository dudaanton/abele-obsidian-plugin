import { expect, it, vi } from 'vitest'
import { ToolDiscovery } from '@/ai/ToolDiscovery'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { AgentTool, ModelConfig, AssistantMessage } from '@/ai/client'

const tool = (name: string): AgentTool => ({
  name,
  label: name,
  description: name,
  parameters: { type: 'object', properties: {} },
  execute: async () => ({ content: [{ type: 'text', text: name }] }),
})
const available = [tool('read'), tool('sample_map'), tool('sample_server')]
const metadata = [
  { name: 'sample_map', label: 'Sample map', category: 'Maps' },
  { name: 'sample_server', label: 'Sample server tool', category: 'MCP: Sample server' },
]
const core = new Set(['read'])

it('groups ordinary and external tools without a platform API', async () => {
  const discovery = new ToolDiscovery()
  const save = vi.fn()
  const offer = () => discovery.offer(available, metadata, core, save)
  expect(offer().map((t) => t.name)).toEqual(['read', 'enable_tools'])
  await offer()[1].execute('sample-enable', { group: 'MCP: Sample server' })
  expect(save).toHaveBeenCalledOnce()
  expect(discovery.revealed).toEqual(['MCP: Sample server'])
  expect(offer().map((t) => t.name)).toEqual(['read', 'enable_tools', 'sample_server'])
  const reopened = new ToolDiscovery(discovery.revealed)
  expect(reopened.offer(available, metadata, core, save).map((t) => t.name)).toEqual(
    offer().map((t) => t.name)
  )
})

it('refreshes schemas and tool execution during the same agent loop', async () => {
  const discovery = new ToolDiscovery()
  const offered: string[][] = []
  const stream = vi
    .spyOn(OpenAIClient.prototype, 'stream')
    .mockImplementation(async function* (_m, _s, _history, tools) {
      offered.push(tools.map((t) => t.name))
      const n = offered.length
      const content: AssistantMessage['content'] =
        n === 1
          ? [
              {
                type: 'toolCall',
                id: 'sample-enable',
                name: 'enable_tools',
                arguments: { group: 'Maps' },
              },
            ]
          : n === 2
            ? [{ type: 'toolCall', id: 'sample-use', name: 'sample_map', arguments: {} }]
            : [{ type: 'text', text: 'done' }]
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content,
          model: 'sample',
          timestamp: 1,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: n < 3 ? 'toolUse' : 'stop',
        },
      }
    })
  try {
    const getTools = () => discovery.offer(available, metadata, core, async () => {})
    const result = await new AgentLoop().run({
      model: { id: 'sample' } as ModelConfig,
      systemPrompt: '',
      messages: [],
      tools: getTools(),
      getTools,
    })
    expect(offered).toEqual([
      ['read', 'enable_tools'],
      ['read', 'enable_tools', 'sample_map'],
      ['read', 'enable_tools', 'sample_map'],
    ])
    expect(result.messages.filter((m) => m.role === 'toolResult').map((m) => m.content)).toEqual([
      expect.any(Array),
      [{ type: 'text', text: 'sample_map' }],
    ])
  } finally {
    stream.mockRestore()
  }
})
