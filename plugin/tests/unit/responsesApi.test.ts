import { afterEach, expect, it, vi } from 'vitest'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { ModelConfig, Message, StreamEvent } from '@/ai/client/types'
const model = {
  id: 'sample',
  baseUrl: 'https://sample.invalid/v1',
  apiMode: 'responses',
  apiKey: '',
  maxTokens: 1000,
  supportsReasoning: true,
} as ModelConfig
const user: Message = { role: 'user', content: 'Hello', timestamp: 1 }
const event = (type: string, fields = {}) => ({ type, ...fields })
function fake(events: unknown[]) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')))
}
async function run(messages: Message[] = [user], signal?: AbortSignal) {
  const events: StreamEvent[] = []
  for await (const e of new OpenAIClient().stream(
    model,
    'Be helpful',
    messages,
    [{ name: 'inspect', description: 'Inspect', parameters: { type: 'object' } }],
    { reasoningEffort: 'high', signal }
  ))
    events.push(e)
  return events
}
afterEach(() => vi.restoreAllMocks())
it('streams text, reasoning and usage through stateless Responses', async () => {
  const fetch = fake([
    event('response.reasoning_summary_text.delta', { delta: 'Consider' }),
    event('response.output_text.delta', { delta: 'Hello' }),
    event('response.completed', {
      response: {
        usage: {
          input_tokens: 20,
          output_tokens: 10,
          input_tokens_details: { cached_tokens: 5 },
          output_tokens_details: { reasoning_tokens: 4 },
        },
      },
    }),
  ])
  const events = await run()
  expect(fetch.mock.calls[0][0]).toBe('https://sample.invalid/v1/responses')
  expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toMatchObject({
    store: false,
    instructions: 'Be helpful',
    reasoning: { effort: 'high' },
    tools: [{ type: 'function', name: 'inspect' }],
  })
  expect(events).toContainEqual({ type: 'thinking_delta', delta: 'Consider' })
  expect(events.at(-1)).toMatchObject({
    type: 'done',
    message: { usage: { input: 15, output: 10, cacheRead: 5, totalTokens: 30 } },
  })
})
it('assembles parallel calls and maps results and images on the next turn', async () => {
  const fetch = fake([
    ...['a', 'b'].map((id, output_index) =>
      event('response.output_item.added', {
        output_index,
        item: {
          type: 'function_call',
          id: `item_${id}`,
          call_id: `call_${id}`,
          name: 'inspect',
          arguments: '',
        },
      })
    ),
    event('response.function_call_arguments.delta', { item_id: 'item_a', delta: '{"x":' }),
    event('response.function_call_arguments.delta', { item_id: 'item_b', delta: '{"x":2}' }),
    event('response.function_call_arguments.delta', { item_id: 'item_a', delta: '1}' }),
    event('response.completed', { response: {} }),
  ])
  const last = (await run()).at(-1)!
  expect(last).toMatchObject({
    type: 'done',
    message: {
      stopReason: 'toolUse',
      content: [
        { id: 'call_a', arguments: { x: 1 } },
        { id: 'call_b', arguments: { x: 2 } },
      ],
    },
  })
  if (last.type !== 'done') throw Error('Missing completion')
  fetch.mockRestore()
  const next = fake([
    event('response.output_text.delta', { delta: 'Done' }),
    event('response.completed', { response: {} }),
  ])
  await run([
    user,
    last.message,
    {
      role: 'toolResult',
      toolCallId: 'call_a',
      toolName: 'inspect',
      content: [{ type: 'text', text: 'Found' }],
      isError: false,
      timestamp: 2,
    },
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
      timestamp: 3,
    },
  ])
  expect(JSON.parse(next.mock.calls[0][1]!.body as string).input).toEqual(
    expect.arrayContaining([
      { type: 'function_call_output', call_id: 'call_a', output: 'Found' },
      { type: 'function_call_output', call_id: 'call_b', output: 'Tool result unavailable' },
      { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AAAA' }] },
    ])
  )
})
it.each(['response.failed', 'error'])('reports %s safely', async (type) => {
  fake([
    event(type, {
      message: 'private upstream body',
      response: { error: { message: 'private upstream body' } },
    }),
  ])
  const events = await run()
  expect(events.at(-1)).toMatchObject({ type: 'error' })
  expect(JSON.stringify(events)).not.toContain('private upstream body')
})
it('rejects EOF and maps output limits', async () => {
  const fetch = fake([event('response.output_text.delta', { delta: 'Partial' })])
  expect((await run()).at(-1)).toMatchObject({ type: 'error' })
  fetch.mockRestore()
  fake([
    event('response.output_text.delta', { delta: 'Partial' }),
    event('response.incomplete', {
      response: { incomplete_details: { reason: 'max_output_tokens' } },
    }),
  ])
  expect((await run()).at(-1)).toMatchObject({ type: 'done', message: { stopReason: 'length' } })
})
it('honors cancellation before transport', async () => {
  const fetch = fake([])
  const controller = new AbortController()
  controller.abort()
  expect((await run([user], controller.signal)).at(-1)).toMatchObject({
    type: 'done',
    message: { stopReason: 'aborted' },
  })
  expect(fetch).not.toHaveBeenCalled()
})

it('streams function arguments before completion and preserves exact call IDs', async () => {
  let finish: (() => void) | undefined
  const callId = 'call_' + 'sample'.repeat(10)
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (value: unknown) =>
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
      send(
        event('response.output_item.added', {
          item: {
            type: 'function_call',
            id: 'item_sample',
            call_id: callId,
            name: 'inspect',
            arguments: '',
          },
        })
      )
      send(
        event('response.function_call_arguments.delta', {
          item_id: 'item_sample',
          delta: '{"x":1}',
        })
      )
      finish = () => {
        send(event('response.completed', { response: {} }))
        controller.close()
      }
    },
  })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(stream))
  const iterator = new OpenAIClient().stream(model, '', [user], [])
  expect((await iterator.next()).value).toMatchObject({
    type: 'tool_call_start',
    toolCallId: callId,
  })
  expect((await iterator.next()).value).toMatchObject({ type: 'tool_call_delta', delta: '{"x":1}' })
  finish!()
  const rest: StreamEvent[] = []
  for await (const value of iterator) rest.push(value)
  expect(rest.at(-1)).toMatchObject({
    type: 'done',
    message: { content: [{ id: callId, arguments: { x: 1 } }] },
  })
})

it('cancels a stalled stream immediately when Stop is pressed', async () => {
  let started!: () => void
  const reading = new Promise<void>((resolve) => {
    started = resolve
  })
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>(
    {
      pull() {
        started()
      },
      cancel,
    },
    { highWaterMark: 0 }
  )
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body))
  const controller = new AbortController()
  const pending = run([user], controller.signal)
  await reading
  controller.abort()
  expect((await pending).at(-1)).toMatchObject({ type: 'done', message: { stopReason: 'aborted' } })
  expect(cancel).toHaveBeenCalled()
})

it('finishes at the terminal Responses event even when the connection stays open', async () => {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const value of [
        event('response.output_text.delta', { delta: 'Done' }),
        event('response.completed', { response: {} }),
      ]) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`))
      }
    },
    cancel,
  })
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body))
  expect((await run()).at(-1)).toMatchObject({ type: 'done' })
  expect(cancel).toHaveBeenCalled()
})
