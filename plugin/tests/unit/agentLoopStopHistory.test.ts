import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { AgentTool, Message, ModelConfig } from '@/ai/client'

const model = { id: 'sample', baseUrl: 'https://sample.invalid', apiKey: '', maxTokens: 100 } as ModelConfig
const user: Message = { role: 'user', content: 'Update the sample note', timestamp: 1 }

function response(delta: unknown, finish_reason = 'stop') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\ndata: [DONE]\n\n`)
}

afterEach(() => vi.restoreAllMocks())

describe('history after a completed tool', () => {
  it.each(['network', 'stop', 'hook'] as const)('survives a %s failure before the next answer', async (failure) => {
    const loop = new AgentLoop()
    const execute = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'Saved sample-note.md' }] }))
    const tool: AgentTool = { name: 'write', description: '', parameters: {}, execute }
    const fetch = vi.spyOn(window, 'fetch')
      .mockResolvedValueOnce(response({ tool_calls: [{ index: 0, id: 'saved-call', function: { name: 'write', arguments: '{}' } }] }, 'tool_calls'))
      .mockImplementationOnce(async () => {
        if (failure === 'stop') {
          loop.abort()
          throw new DOMException('Stopped', 'AbortError')
        }
        throw new TypeError('Network disconnected')
      })
    let iterations = 0
    const result = await loop.run({
      model, systemPrompt: '', messages: [user], tools: [tool],
      beforeIteration: () => {
        if (++iterations === 2 && failure === 'hook') throw new Error('Iteration failed')
        return []
      },
    })
    expect(result.messages.slice(0, 3).map((m) => m.role)).toEqual(['user', 'assistant', 'toolResult'])
    expect(result.messages[2]).toMatchObject({ toolCallId: 'saved-call', content: [{ text: 'Saved sample-note.md' }] })

    fetch.mockResolvedValueOnce(response({ content: 'Already saved.' }))
    await loop.run({ model, systemPrompt: '', messages: result.messages, tools: [tool] })
    const request = JSON.parse(String(fetch.mock.calls.at(-1)![1]!.body))
    expect(request.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'assistant', tool_calls: [expect.objectContaining({ id: 'saved-call' })] }),
      expect.objectContaining({ role: 'tool', tool_call_id: 'saved-call', content: 'Saved sample-note.md' }),
    ]))
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it.each(['error', 'aborted'] as const)('serializes completed calls even on a stored %s assistant message', async (stopReason) => {
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(response({ content: 'Done' }))
    const messages: Message[] = [user, {
      role: 'assistant', model: model.id, timestamp: 1, stopReason,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      content: [{ type: 'toolCall', id: 'saved-call', name: 'write', arguments: {} }],
    }, { role: 'toolResult', toolCallId: 'saved-call', toolName: 'write', isError: false, timestamp: 1,
      content: [{ type: 'text', text: 'Saved sample-note.md' }] }]
    for await (const _event of new OpenAIClient().stream(model, '', messages, [])) { /* drain */ }
    const request = JSON.parse(String(fetch.mock.calls[0][1]!.body))
    expect(request.messages[1].tool_calls[0].id).toBe('saved-call')
    expect(request.messages[2]).toMatchObject({ role: 'tool', tool_call_id: 'saved-call' })
  })
})
