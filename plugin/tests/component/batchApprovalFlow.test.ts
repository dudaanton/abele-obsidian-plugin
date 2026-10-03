import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { shallowRef, nextTick, watch, type WatchStopHandle } from 'vue'
import AiChat from '@/components/AiChat.vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { AgentTool, Message, ToolCallContent } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

let batches: ToolCallContent[][]
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream() {
      const calls = batches.shift() ?? []
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content: calls.length ? calls : [{ type: 'text', text: 'Sample answer' }],
          model: 'sample-model',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          stopReason: calls.length ? 'toolUse' : 'stop',
          timestamp: Date.now(),
        },
      }
    }
  },
}))
const provider: AiProvider = {
  id: 'sample-provider',
  name: 'Sample provider',
  baseUrl: 'https://model.example/v1',
  apiKeyId: '',
  models: [
    {
      id: 'sample-model',
      name: 'Sample model',
      contextWindow: 32000,
      maxTokens: 100,
      supportsReasoning: false,
    },
  ],
}
const call = (id: string, name = 'demo', args: Record<string, unknown> = {}): ToolCallContent => ({
  type: 'toolCall',
  id,
  name,
  arguments: args,
})
let session: ChatSession
const active = shallowRef<ChatSession | null>(null)
let view: ReturnType<typeof mount>
let executed: string[]
let mounted: string[]
let pendingStates: string[]
let frames: string[]
const watches: WatchStopHandle[] = []
let hold: ReturnType<typeof deferred> | undefined
const makeSession = () => {
  const s = new ChatSession(ChatService.getInstance())
  vi.spyOn(s, 'save').mockResolvedValue()
  s.permissionMode.value = 'confirm-all'
  s.toolModes.value = { demo: 'ask', other: 'ask', fetch: 'auto' }
  s.scopeResolver.clear()
  s.scopeResolver.addFile('Sample/visible.md')
  vi.spyOn(s as unknown as { getTools(): AgentTool[] }, 'getTools').mockReturnValue(
    ['demo', 'other', 'create', 'rm', 'fetch'].map((name) => ({
      name,
      label: name,
      description: 'Synthetic tool without side effects',
      parameters: {},
      execute: async (id, _args, signal) => {
        executed.push(`${s.id}:${id}`)
        await nextTick()
        frames.push(
          ...view.findAllComponents(AiToolApproval).map((c) => c.props('message').toolCallId)
        )
        if (hold) {
          const waiting = hold
          await Promise.race([
            waiting.promise,
            new Promise<void>((resolve) =>
              signal?.addEventListener('abort', () => resolve(), { once: true })
            ),
          ])
        }
        return { content: [{ type: 'text', text: 'done' }] }
      },
    }))
  )
  const summarizer = (
    s as unknown as {
      summarizer: { generateTitle(): Promise<void>; autoCompactIfNeeded(): Promise<void> }
    }
  ).summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue()
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue()
  // This is the same selector AiChat renders, observed synchronously as well as at mounts/frames.
  watches.push(
    watch(
      [s.pendingToolCalls, s.messages],
      () => {
        const id = s.pendingToolCalls.value[0]?.id
        if (s.messages.value.some((m) => m.toolCallId === id && m.toolStatus === 'pending'))
          pendingStates.push(id!)
      },
      { flush: 'sync' }
    )
  )
  return s
}
const button = (text: string) => view.findAll('button').find((b) => b.text() === text)!
const start = async (...calls: ToolCallContent[]) => {
  batches = [calls]
  await session.sendMessage('Use the sample tools')
  await flushPromises()
  expect(mounted).toEqual([calls[0].id])
}

destroyChatsAfterEach()
beforeEach(() => {
  useVault([{ path: 'Sample/visible.md', content: 'sample' }])
  AgentRegistry.destroy()
  const config = AbeleConfig.getInstance()
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
    secrets: [{ name: 'sample', keyId: 'sample-key' }],
  }
  vi.spyOn(config, 'saveSettings').mockResolvedValue()
  const agent = AgentRegistry.getInstance().create({
    name: 'Sample worker',
    providerId: provider.id,
    modelId: 'sample-model',
  })
  AgentRegistry.getInstance().setDefault(agent.id)
  executed = []
  mounted = []
  pendingStates = []
  frames = []
  batches = []
  hold = undefined
  session = makeSession()
  active.value = session
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'getSystemPrompt').mockResolvedValue('')
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue(active)
  view = mount(AiChat, {
    attachTo: document.body,
    global: {
      mixins: [
        {
          mounted() {
            if (this.$options.__name === 'AiToolApproval')
              mounted.push(this.$props.message.toolCallId)
          },
        },
      ],
    },
  })
})
afterEach(() => {
  view.unmount()
  watches.splice(0).forEach((stop) => stop())
  active.value = null
  vi.restoreAllMocks()
})

describe('the Always allow transition at the runtime and rendered chat seams', () => {
  it('never exposes covered queued calls even for one mounted frame', async () => {
    await start(call('first'), call('second'), call('third'))
    await button('Always allow').trigger('click')
    await flushPromises()
    expect(executed).toEqual(['first', 'second', 'third'].map((id) => `${session.id}:${id}`))
    expect(mounted).toEqual(['first'])
    expect(pendingStates.filter((id) => id !== 'first')).toEqual([])
    expect(frames).toEqual([])
  })

  it('also never exposes automatic calls in the next sequential model batch', async () => {
    await start(call('first'), call('second'))
    batches.push([call('next-first'), call('next-second')])
    await button('Always allow').trigger('click')
    await flushPromises()
    expect(executed).toEqual(
      ['first', 'second', 'next-first', 'next-second'].map((id) => `${session.id}:${id}`)
    )
    expect(mounted).toEqual(['first'])
    expect(pendingStates.filter((id) => id !== 'first')).toEqual([])
    expect(frames).toEqual([])
  })

  it.each([
    call('uncovered', 'other'),
    call('uncovered', 'fetch', {
      url: 'https://api.sample.example/data',
      headers: { Authorization: '${abele_key:sample}' },
    }),
    call('uncovered', 'create', { path: 'Unrelated/hidden.md', content: 'sample' }),
  ])('still mounts the uncovered $name call, in order', async (uncovered) => {
    await start(call('first'), call('covered'), uncovered, call('after'))
    await button('Always allow').trigger('click')
    await flushPromises()
    expect(executed).toEqual(['first', 'covered'].map((id) => `${session.id}:${id}`))
    expect(mounted).toEqual(['first', 'uncovered'])
    expect(pendingStates).not.toContain('covered')
    expect(session.pendingToolCalls.value.map((tc) => tc.id)).toEqual(['uncovered', 'after'])
    await button('Reject').trigger('click')
    await flushPromises()
    expect(executed).toEqual(['first', 'covered', 'after'].map((id) => `${session.id}:${id}`))
    expect(mounted).toEqual(['first', 'uncovered'])
  })

  it('covers only scoped writes after Always allow writes, not deletes', async () => {
    const write = (id: string) =>
      call(id, 'create', { path: 'Sample/visible.md', content: 'sample' })
    await start(
      write('first'),
      write('covered'),
      call('delete', 'rm', { path: 'Sample/visible.md' })
    )
    await button('Always allow writes').trigger('click')
    await flushPromises()
    expect(executed).toEqual(['first', 'covered'].map((id) => `${session.id}:${id}`))
    expect(mounted).toEqual(['first', 'delete'])
    expect(pendingStates).not.toContain('covered')
    expect(session.needsApproval('write', { path: 'Unrelated/hidden.md' })).toBe(true)
  })

  it('uses the immediate chat grant while settings persistence is delayed, without granting another chat', async () => {
    const saving = deferred()
    vi.mocked(AbeleConfig.getInstance().saveSettings).mockReturnValue(saving.promise)
    const other = makeSession()
    batches = [[call('other-first'), call('other-second')]]
    await other.sendMessage('Use other sample tools')
    await start(call('first'), call('second'))
    await button('Always allow').trigger('click')
    await flushPromises()
    expect(executed).toEqual(['first', 'second'].map((id) => `${session.id}:${id}`))
    expect(mounted).toEqual(['first'])
    expect(other.getToolMode('demo')).toBe('ask')
    expect(other.pendingToolCalls.value.map((tc) => tc.id)).toEqual(['other-first', 'other-second'])
    saving.resolve()
  })

  it('can cancel an approved batch without running later calls or showing their cards', async () => {
    await start(call('first'), call('second'), call('third'))
    hold = deferred()
    await button('Always allow').trigger('click')
    await nextTick()
    session.abortToolExecution()
    hold.resolve()
    await flushPromises()
    expect(executed).toEqual([`${session.id}:first`])
    expect(mounted).toEqual(['first'])
    expect(frames).toEqual([])
    expect(session.pendingToolCalls.value.map((tc) => tc.id)).toEqual(['second', 'third'])
  })
})
