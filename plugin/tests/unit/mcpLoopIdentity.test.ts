import { describe, expect, it, vi } from 'vitest'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { AgentTool, ModelConfig, ToolCallContent } from '@/ai/client'
import { mcpPermissionKey } from '@/ai/mcp/permissions'

const tool = (id: string, name = 'mcp_archive_echo'): AgentTool => ({
  name,
  permissionKey: mcpPermissionKey(id, 'echo'),
  label: 'Echo',
  description: '',
  parameters: {},
  execute: vi.fn(async () => ({ content: [{ type: 'text', text: 'done' }] })),
})
const call = (id: string, name = 'mcp_archive_echo'): ToolCallContent => ({
  type: 'toolCall',
  id,
  name,
  arguments: {},
})
const streamCalls = (calls: ToolCallContent[], duringResponse?: () => void) => {
  let first = true
  vi.spyOn(OpenAIClient.prototype, 'stream').mockImplementation(async function* () {
    const content = first ? calls : [{ type: 'text', text: 'done' }]
    if (first) duringResponse?.()
    first = false
    yield {
      type: 'done',
      message: {
        role: 'assistant',
        content,
        timestamp: 1,
        stopReason: 'stop',
        model: 'sample',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      },
    }
  } as never)
}
const run = (
  getTools: () => AgentTool[],
  beforeToolCall?: Parameters<AgentLoop['run']>[0]['beforeToolCall']
) =>
  new AgentLoop().run({
    model: { id: 'sample', name: 'Sample', contextWindow: 1000, maxTokens: 100 } as ModelConfig,
    systemPrompt: '',
    messages: [],
    tools: getTools(),
    getTools,
    beforeToolCall,
  })

describe('MCP identities at the model request boundary', () => {
  it('pins every call before pausing, including the untouched tail of a response', async () => {
    const tools = [tool('a'), tool('b', 'mcp_second_echo')]
    streamCalls([call('first'), call('second', 'mcp_second_echo')])
    const result = await run(
      () => tools,
      async () => ({ pause: true })
    )
    expect(result.pausedAt?.map((tc) => tc.permissionKey)).toEqual(
      tools.map((t) => t.permissionKey)
    )
    expect(tools[0].execute).not.toHaveBeenCalled()
  })

  it('does not bind an unoffered MCP alias to a server added while the model answered', async () => {
    const replacement = tool('b')
    let current: AgentTool[] = []
    streamCalls([call('first')], () => {
      current = [replacement]
    })
    const result = await run(() => current)
    expect(replacement.execute).not.toHaveBeenCalled()
    expect(result.messages.find((m) => m.role === 'toolResult')).toMatchObject({ isError: true })
  })

  it.each(['response', 'approval'])(
    'refuses reassignment during %s rather than executing either identity',
    async (when) => {
      const original = tool('a')
      const replacement = tool('b')
      let current = [original]
      streamCalls(
        [call('first')],
        when === 'response'
          ? () => {
              current = [replacement]
            }
          : undefined
      )
      const result = await run(
        () => current,
        async () => {
          if (when === 'approval') current = [replacement]
        }
      )
      expect(original.execute).not.toHaveBeenCalled()
      expect(replacement.execute).not.toHaveBeenCalled()
      expect(result.messages.find((m) => m.role === 'toolResult')).toMatchObject({
        isError: true,
        content: [{ type: 'text', text: expect.stringContaining('MCP tool changed') }],
      })
    }
  )
})
