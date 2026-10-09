import { afterEach, expect, it, vi } from 'vitest'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import { EMPTY_USAGE, type Message, type ModelConfig } from '@/ai/client'
import { getInternalMessagesForPath, getPathToLeaf } from '@/ai/chatTree'
import type { ChatMessage } from '@/ai/types'
import { repairAnthropicToolHistory, repairOpenAIToolHistory } from '@/ai/client/toolHistory'
import { parseChat, serializeChat } from '@/ai/ChatLog'
import { projectReplyHistory } from '@/ai/replyAnnotations'
import { ChatSession } from '@/ai/ChatSession'

const model = {
  id: 'sample',
  baseUrl: 'https://sample.invalid',
  apiKey: '',
  maxTokens: 100,
} as ModelConfig
const user: Message = {
  role: 'user',
  content: 'Inspect two samples',
  timestamp: 1,
  chatMessageId: 'q',
}
const assistant = (ids: string[], chatMessageId = 'a'): Message => ({
  role: 'assistant',
  content: ids.map((id) => ({ type: 'toolCall', id, name: 'inspect', arguments: {} })),
  model: 'sample',
  usage: { ...EMPTY_USAGE },
  stopReason: 'toolUse',
  timestamp: 2,
  chatMessageId,
})
const result = (id: string, chatMessageId = 't'): Message => ({
  role: 'toolResult',
  toolCallId: id,
  toolName: 'inspect',
  content: [{ type: 'text', text: id }],
  isError: false,
  timestamp: 3,
  chatMessageId,
})
function response(delta: unknown, finish_reason = 'stop') {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta, finish_reason }] })}\n\ndata: [DONE]\n\n`
  )
}
afterEach(() => vi.restoreAllMocks())

it('preserves valid results, repairs dangling calls at system boundaries and logs only indices', () => {
  const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
  const messages = [
    { role: 'assistant', content: '', tool_calls: [{ id: 'one' }, { id: 'two' }] },
    { role: 'tool', content: 'Completed', tool_call_id: 'one' },
    { role: 'system', content: 'Summary' },
    { role: 'tool', content: 'Late', tool_call_id: 'two' },
  ]
  const original = structuredClone(messages)
  const repaired = repairOpenAIToolHistory(messages)
  expect(repaired).toEqual([
    messages[0],
    messages[1],
    { role: 'tool', content: 'Tool result unavailable', tool_call_id: 'two' },
    messages[2],
  ])
  expect(messages).toEqual(original)
  expect(debug.mock.calls.map((c) => c[1])).toEqual([{ callIndex: 0, index: 2 }, { index: 3 }])
  expect(repairOpenAIToolHistory(repaired)).toEqual(repaired)
})

it('repairs Anthropic tool blocks, keeping parallel error results and ordinary user text', () => {
  const messages = [
    {
      role: 'user' as const,
      content: [
        { type: 'tool_result', tool_use_id: 'orphan', content: 'Lost' },
        { type: 'text', text: 'Question' },
      ],
    },
    {
      role: 'assistant' as const,
      content: [
        { type: 'tool_use', id: 'one', name: 'inspect', input: {} },
        { type: 'tool_use', id: 'two', name: 'inspect', input: {} },
      ],
    },
    {
      role: 'user' as const,
      content: [
        { type: 'tool_result', tool_use_id: 'one', content: 'Failed', is_error: true },
        { type: 'tool_result', tool_use_id: 'one', content: 'Duplicate' },
        { type: 'text', text: 'Continue' },
      ],
    },
    {
      role: 'user' as const,
      content: [{ type: 'tool_result', tool_use_id: 'two', content: 'Too late' }],
    },
  ]
  const original = structuredClone(messages)
  const repaired = repairAnthropicToolHistory(messages)
  expect(repaired).toEqual([
    { role: 'user', content: [{ type: 'text', text: 'Question' }] },
    messages[1],
    {
      role: 'user',
      content: [
        messages[2].content[0],
        {
          type: 'tool_result',
          tool_use_id: 'two',
          content: 'Tool result unavailable',
          is_error: true,
        },
        { type: 'text', text: 'Continue' },
      ],
    },
  ])
  expect(messages).toEqual(original)
  expect(repairAnthropicToolHistory(repaired)).toEqual(repaired)
})

it('keeps all results of parallel calls before injected image messages', async () => {
  const fetch = vi
    .spyOn(window, 'fetch')
    .mockResolvedValueOnce(
      response(
        {
          tool_calls: ['one', 'two'].map((id, index) => ({
            index,
            id,
            function: { name: 'inspect', arguments: '{}' },
          })),
        },
        'tool_calls'
      )
    )
    .mockResolvedValueOnce(response({ content: 'Done' }))
  const history = await new AgentLoop().run({
    model,
    systemPrompt: '',
    messages: [user],
    tools: [
      {
        name: 'inspect',
        description: '',
        parameters: {},
        execute: async (id) => ({
          content: [{ type: 'text', text: id }],
          ...(id === 'one'
            ? { injectMessages: [{ role: 'user' as const, content: 'Sample image', timestamp: 3 }] }
            : {}),
        }),
      },
    ],
  })
  expect(history.messages.slice(0, 5).map((m) => m.role)).toEqual([
    'user',
    'assistant',
    'toolResult',
    'toolResult',
    'user',
  ])
  const wire = JSON.parse(String(fetch.mock.calls[1][1]!.body)).messages
  expect(wire.slice(0, 5).map((m: { role: string }) => m.role)).toEqual([
    'user',
    'assistant',
    'tool',
    'tool',
    'user',
  ])
})

it('does not retain an unlinked result from an unselected variant', () => {
  const path = [
    { id: 'q', role: 'user' },
    { id: 'b', role: 'assistant' },
  ] as ChatMessage[]
  const internal = [user, assistant(['one']), result('one'), assistant([], 'b')]
  delete internal[2].chatMessageId
  expect(getInternalMessagesForPath(path, internal)).toEqual([user, internal[3]])
})

it('projects stored approval results before their linked image injection', () => {
  const path = [
    { id: 'q', role: 'user' },
    { id: 'a', role: 'assistant' },
    { id: 't1', role: 'tool-call', toolCallId: 'one' },
    { id: 't2', role: 'tool-call', toolCallId: 'two' },
  ] as ChatMessage[]
  const image: Message = {
    role: 'user',
    content: 'Sample image',
    timestamp: 3,
    chatMessageId: 't1',
  }
  const internal = [
    user,
    assistant(['one', 'two']),
    result('one', 't1'),
    image,
    result('two', 't2'),
  ]
  expect(getInternalMessagesForPath(path, internal)).toEqual([
    user,
    internal[1],
    internal[2],
    internal[4],
    image,
  ])
  expect(internal[3]).toBe(image)
})

it('keeps a batched image attached to its originating call when rewinding the next call', () => {
  const first = result('one')
  const image: Message = { role: 'user', content: 'Sample image', timestamp: 3 }
  if (first.role !== 'toolResult') throw new Error('Expected result')
  first.injectMessages = [image]
  const path = [
    { id: 'q', role: 'user' },
    { id: 'a', role: 'assistant' },
    { id: 't1', role: 'tool-call', toolCallId: 'one' },
    { id: 't2', role: 'tool-call', toolCallId: 'two' },
  ] as ChatMessage[]
  const messages = [assistant(['one', 'two']), first, result('two'), image]
  const link = (ChatSession.prototype as unknown as { linkInternalMessages(m: Message[]): void })
    .linkInternalMessages
  link.call({ messages: { value: path } }, messages)
  expect(image.chatMessageId).toBe('t1')
  expect(getInternalMessagesForPath(path.slice(0, -1), messages)).toContain(image)
})

it.each(['pause', 'error'])(
  'retains an injected image after a later call encounters %s',
  async (outcome) => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      response(
        {
          tool_calls: ['one', 'two'].map((id, index) => ({
            index,
            id,
            function: { name: 'inspect', arguments: '{}' },
          })),
        },
        'tool_calls'
      )
    )
    const history = await new AgentLoop().run({
      model,
      systemPrompt: '',
      messages: [user],
      beforeToolCall: async (_name, id) => {
        if (id === 'two') {
          if (outcome === 'pause') return { pause: true }
          throw new Error('Sample preparation failure')
        }
      },
      tools: [
        {
          name: 'inspect',
          description: '',
          parameters: {},
          execute: async () => ({
            content: [{ type: 'text', text: 'Image loaded' }],
            injectMessages: [{ role: 'user', content: 'Sample image', timestamp: 3 }],
          }),
        },
      ],
    })
    expect(history.messages.map((m) => m.role)).toEqual(
      outcome === 'pause'
        ? ['user', 'assistant', 'toolResult', 'user']
        : ['user', 'assistant', 'toolResult', 'toolResult', 'user']
    )
    expect(history.messages.at(-1)?.content).toBe('Sample image')
    expect(history.pausedAt?.map((tc) => tc.id)).toEqual(outcome === 'pause' ? ['two'] : undefined)
    if (outcome === 'error')
      expect(history.messages[3]).toMatchObject({ role: 'toolResult', isError: true })
  }
)

it.each(['a', 'b', 'q'])(
  'round trips a stored variant and rewind path %s without unpaired results',
  async (leaf) => {
    const chats: ChatMessage[] = [
      { id: 'q', role: 'user', content: 'Sample question', timestamp: 1 },
      { id: 'a', parentId: 'q', role: 'assistant', content: 'First variant', timestamp: 2 },
      { id: 'ta', parentId: 'a', role: 'tool-call', toolCallId: 'one', content: '', timestamp: 3 },
      {
        id: 'b',
        parentId: 'q',
        role: 'assistant',
        content: 'Revised variant',
        timestamp: 4,
        revisions: [
          {
            proposal: 'sample-revision',
            before: 'Other variant',
            after: 'Revised variant',
            author: 'Sample editor',
            at: 5,
            highlights: [],
          },
        ],
      },
      { id: 'tb', parentId: 'b', role: 'tool-call', toolCallId: 'two', content: '', timestamp: 5 },
    ]
    const unlinked = result('one')
    delete unlinked.chatMessageId
    const parsed = parseChat(
      serializeChat({
        metadata: { type: 'abele-chat', created: '2030-01-01', providerId: '', modelId: '' },
        messages: chats,
        internalMessages: [
          user,
          assistant(['one']),
          unlinked,
          assistant(['two'], 'b'),
          result('two', 'tb'),
        ],
      })
    )
    const path = getPathToLeaf(parsed.messages, leaf === 'q' ? 'q' : `t${leaf}`)
    const messages = projectReplyHistory(
      path,
      getInternalMessagesForPath(path, parsed.internalMessages)
    )
    const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(response({ content: 'Done' }))
    for await (const event of new OpenAIClient().stream(model, '', messages, [])) void event
    const wire = JSON.parse(String(fetch.mock.calls[0][1]!.body)).messages
    expect(
      wire
        .filter((m: { role: string }) => m.role === 'tool')
        .map((m: { tool_call_id: string }) => m.tool_call_id)
    ).toEqual(leaf === 'q' ? [] : [leaf === 'a' ? 'one' : 'two'])
    if (leaf === 'b') expect(wire[1].content).toBe('Revised variant')
  }
)

it.each([
  [result('orphan')],
  [assistant(['one', 'two']), result('one'), result('one')],
  [assistant(['one']), user, result('one')],
  [{ ...assistant(['one']), stopReason: 'aborted' }, user],
  [
    { ...assistant(['one']), stopReason: 'error' },
    { ...result('one'), isError: true },
  ],
] as Message[][])('repairs damaged stored history before sending %#', async (...messages) => {
  const fetch = vi.spyOn(window, 'fetch').mockResolvedValue(response({ content: 'Done' }))
  for await (const event of new OpenAIClient().stream(model, '', messages, [])) void event
  const wire = JSON.parse(String(fetch.mock.calls[0][1]!.body)).messages
  const pending = new Set<string>()
  for (const message of wire) {
    if (message.role === 'tool') {
      expect(pending.delete(message.tool_call_id)).toBe(true)
    } else {
      expect(pending.size).toBe(0)
      for (const tc of message.tool_calls ?? []) pending.add(tc.id)
    }
  }
  expect(pending.size).toBe(0)
})
