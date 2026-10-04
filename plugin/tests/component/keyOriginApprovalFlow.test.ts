import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { shallowRef, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { AgentTool, Message, ToolCallContent } from '@/ai/client'
import { initializeDestinations } from '@/secrets/destinations'
import { needsSecretApproval } from '@/ai/tools/secretUtils'
import * as secretUtils from '@/ai/tools/secretUtils'
import { createMcpServer } from '@/ai/mcp/types'
import { acceptDestinations } from '@/secrets/destinations'
import { setSecrets } from '@/secrets/SecretStore'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

let planned: ToolCallContent[] = []
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(_model: unknown, _prompt: string, messages: Message[]) {
      const calls = messages.some((m) => m.role === 'toolResult') ? [] : planned
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
const request = {
  url: 'https://api.sample.example/data',
  headers: { Authorization: '${abele_key:sample}' },
}
const call = (id: string, args = request): ToolCallContent => ({
  type: 'toolCall',
  id,
  name: 'fetch',
  arguments: structuredClone(args),
})
let session: ChatSession
const active = shallowRef<ChatSession | null>(null)
let view: ReturnType<typeof mount>
let executed: string[]
const makeSession = () => {
  const s = new ChatSession(ChatService.getInstance())
  vi.spyOn(s, 'save').mockResolvedValue()
  s.toolModes.value = { fetch: 'auto' }
  vi.spyOn(s as unknown as { getTools(): AgentTool[] }, 'getTools').mockReturnValue([
    {
      name: 'fetch',
      label: 'Fetch',
      description: 'Synthetic request; no transport or key values',
      parameters: {},
      execute: async (id) => {
        executed.push(`${s.id}:${id}`)
        await nextTick()
        return { content: [{ type: 'text', text: 'done' }] }
      },
    },
  ])
  const summarizer = (
    s as unknown as {
      summarizer: { generateTitle(): Promise<void>; autoCompactIfNeeded(): Promise<void> }
    }
  ).summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue()
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue()
  return s
}
const button = (text: string) => view.findAll('button').find((b) => b.text() === text)!
const start = async (...calls: ToolCallContent[]) => {
  planned = calls
  await session.sendMessage('Use the sample request')
  await flushPromises()
  expect(view.findComponent(AiToolApproval).exists()).toBe(true)
}

destroyChatsAfterEach()
beforeEach(() => {
  setSecrets(null)
  const app = useVault([])
  app.secretStorage.setSecret('sample-key', 'fake-sample-value')
  app.secretStorage.setSecret('other-key', 'fake-other-value')
  AgentRegistry.destroy()
  const config = AbeleConfig.getInstance()
  config.applySettings(undefined)
  vi.spyOn(config, 'settingsUnreadable', 'get').mockReturnValue(false)
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
    secrets: [{ name: 'sample', keyId: 'sample-key' }],
  }
  vi.spyOn(config, 'saveSettings').mockResolvedValue()
  initializeDestinations(config)
  const agent = AgentRegistry.getInstance().create({
    name: 'Sample worker',
    providerId: provider.id,
    modelId: 'sample-model',
  })
  AgentRegistry.getInstance().setDefault(agent.id)
  executed = []
  session = makeSession()
  active.value = session
  const service = ChatService.getInstance()
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'getSystemPrompt').mockResolvedValue('')
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue(active)
  view = mount(AiChat, { attachTo: document.body })
})
afterEach(() => {
  view.unmount()
  active.value = null
  AbeleConfig.getInstance().destroy()
  setSecrets(null)
  vi.restoreAllMocks()
})

const installRealSettings = async (unreadable = false) => {
  const config = AbeleConfig.getInstance()
  vi.mocked(config.saveSettings).mockRestore()
  vi.mocked(Object.getOwnPropertyDescriptor(config, 'settingsUnreadable')!.get!).mockRestore()
  const ai = config.ai
  let disk: unknown = unreadable ? undefined : JSON.parse(JSON.stringify(config.exportSettings()))
  const write = vi.fn(async (value: unknown) => {
    disk = structuredClone(value)
  })
  const plugin = {
    app: GlobalStore.getInstance().app,
    loadData: async () => disk,
    saveData: write,
    syncAiFeatures: () => {},
  }
  config.init(plugin as never)
  await config.loadSettings()
  config.ai = ai
  write.mockClear()
  return { write, read: () => disk as ReturnType<typeof config.exportSettings> }
}

const mcp = () => {
  const config = AbeleConfig.getInstance()
  const other = 'https://other.example'
  config.ai.secrets[0].allowedOrigins = [other]
  config.ai.secrets.push({
    name: 'other',
    keyId: 'other-key',
    allowedOrigins: [other, 'https://api.sample.example'],
  })
  acceptDestinations([
    { name: 'sample', keyId: 'sample-key', origin: other },
    { name: 'other', keyId: 'other-key', origin: 'https://api.sample.example' },
  ])
  config.ai.mcpServers = [
    createMcpServer({
      name: 'Sample',
      url: request.url,
      headers: { ...request.headers },
      tools: [{ name: 'read', description: '', inputSchema: {} }],
    }),
  ]
  const name = 'mcp_sample_read'
  session.toolModes.value = { [name]: 'auto' }
  vi.mocked((session as unknown as { getTools(): AgentTool[] }).getTools).mockReturnValue([
    {
      name,
      label: 'Sample MCP',
      description: 'Synthetic MCP tool; no transport',
      parameters: {},
      execute: async (id) => {
        executed.push(`${session.id}:${id}`)
        return { content: [{ type: 'text', text: 'done' }] }
      },
    },
  ])
  return {
    tc: { ...call('mcp-first'), name, arguments: { query: 'sample' } },
    server: config.ai.mcpServers[0],
  }
}

describe('resolved requests and actual settings adapter outcomes', () => {
  it('continues an unchanged automatic MCP request exactly once', async () => {
    const { tc } = mcp()
    await start(tc)
    await button('Allow this address for these keys').trigger('click')
    await flushPromises()
    expect(executed).toEqual([`${session.id}:mcp-first`])
    expect(view.findComponent(AiToolApproval).exists()).toBe(false)
  })

  it('does not consent to an undisplayed replacement of a named key ID', async () => {
    const { tc } = mcp()
    await start(tc)
    GlobalStore.getInstance().app.secretStorage!.setSecret(
      'replacement-key',
      'fake-replacement-value'
    )
    AbeleConfig.getInstance().ai.secrets[0].keyId = 'replacement-key'
    await button('Allow this address for these keys').trigger('click')
    await flushPromises()
    expect(executed).toEqual([])
    expect(session.pendingToolCalls.value[0].id).toBe('mcp-first')
    expect(AbeleConfig.getInstance().ai.secrets[0].allowedOrigins).not.toContain(
      'https://api.sample.example'
    )
  })

  it.each(['url', 'header-key', 'header-content'])(
    'does not consent to an undisplayed MCP %s edit before the trust click',
    async (change) => {
      const { tc, server } = mcp()
      await start(tc)
      if (change === 'url') server.url = 'https://other.example/data'
      if (change === 'header-key') server.headers.Authorization = '${abele_key:other}'
      if (change === 'header-content') server.headers['X-Sample'] = 'changed-header'
      await button('Allow this address for these keys').trigger('click')
      await flushPromises()
      expect(executed).toEqual([])
      expect(session.pendingToolCalls.value[0].id).toBe('mcp-first')
      expect(view.findComponent(AiToolApproval).exists()).toBe(true)
    }
  )

  it.each(['url', 'header-key', 'header-content'])(
    'keeps changed MCP %s pending during a delayed trust save',
    async (change) => {
      const { tc, server } = mcp()
      const saving = deferred()
      vi.mocked(AbeleConfig.getInstance().saveSettings).mockReturnValue(saving.promise)
      await start(tc)
      await button('Allow this address for these keys').trigger('click')
      await flushPromises()
      if (change === 'url') server.url = 'https://other.example/data'
      if (change === 'header-key') server.headers.Authorization = '${abele_key:other}'
      if (change === 'header-content') server.headers['X-Sample'] = 'changed-header'
      saving.resolve()
      await flushPromises()
      expect(executed).toEqual([])
      expect(session.pendingToolCalls.value[0].id).toBe('mcp-first')
      expect(view.findComponent(AiToolApproval).exists()).toBe(true)
      if (change !== 'header-content')
        expect(session.needsApproval(tc.name, tc.arguments)).toBe(false)
    }
  )

  it.each(['url', 'header-key', 'header-content'])(
    'keeps changed MCP %s pending between consent commit and continuation',
    async (change) => {
      const { tc, server } = mcp()
      const allow = secretUtils.allowSecretRequestOrigins
      vi.spyOn(secretUtils, 'allowSecretRequestOrigins').mockImplementation(async (...args) => {
        await allow(...args)
        if (change === 'url') server.url = 'https://other.example/data'
        if (change === 'header-key') server.headers.Authorization = '${abele_key:other}'
        if (change === 'header-content') server.headers['X-Sample'] = 'changed-header'
      })
      await start(tc)
      await button('Allow this address for these keys').trigger('click')
      await flushPromises()
      expect(session.needsApproval(tc.name, tc.arguments)).toBe(false)
      expect(executed).toEqual([])
      expect(session.pendingToolCalls.value[0].id).toBe('mcp-first')
      expect(view.findComponent(AiToolApproval).exists()).toBe(true)
    }
  )

  it('does not treat the real adapter no-write outcome as persisted trust', async () => {
    const adapter = await installRealSettings(true)
    const config = AbeleConfig.getInstance()
    expect(config.settingsUnreadable).toBe(true)
    await expect(config.saveSettings()).resolves.toBeUndefined()
    expect(adapter.write).not.toHaveBeenCalled()
    await start(call('first'))
    await button('Allow this address for these keys').trigger('click')
    await flushPromises()
    expect(executed).toEqual([])
    expect(adapter.write).not.toHaveBeenCalled()
    expect(view.text()).toContain('Could not save key permission')
    expect(needsSecretApproval('fetch', request)).toBe(true)
    expect(config.ai.secrets[0].allowedOrigins).toBeUndefined()
  })

  it('writes and reads back origin metadata through the real settings adapter before continuing', async () => {
    const adapter = await installRealSettings()
    await start(call('first'))
    await button('Allow this address for these keys').trigger('click')
    await flushPromises()
    expect(adapter.write).toHaveBeenCalled()
    expect(adapter.read().ai.secrets[0].allowedOrigins).toEqual(['https://api.sample.example'])
    expect(JSON.stringify(adapter.read())).not.toContain('fake-sample-value')
    expect(executed).toEqual([`${session.id}:first`])
    await AbeleConfig.getInstance().reloadSettings()
    expect(needsSecretApproval('fetch', request)).toBe(false)
    expect(view.findComponent(AiToolApproval).exists()).toBe(false)
  })
})

describe('trusting the current saved-key origin', () => {
  it('settles the first call exactly once without a second Send once card', async () => {
    await start(call('first'))
    await button('Allow this address for these keys').trigger('click')
    await flushPromises()
    expect(executed).toEqual([`${session.id}:first`])
    expect(session.pendingToolCalls.value).toEqual([])
    expect(view.findComponent(AiToolApproval).exists()).toBe(false)
    expect(session.toolModes.value).toEqual({ fetch: 'auto' })
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalled()
    expect(needsSecretApproval('fetch', request)).toBe(false)
    expect(needsSecretApproval('fetch', { ...request, url: 'https://other.example/data' })).toBe(
      true
    )
    expect(
      needsSecretApproval('fetch', { ...request, headers: { Authorization: '${abele_key:other}' } })
    ).toBe(true)
  })

  it('does not use destination trust to approve an independent tool permission', async () => {
    session.toolModes.value = { fetch: 'ask' }
    await start(call('first'))
    await button('Allow this address for these keys').trigger('click')
    await flushPromises()
    expect(executed).toEqual([])
    expect(view.findComponent(AiToolApproval).exists()).toBe(true)
    await button('Send once').trigger('click')
    await flushPromises()
    expect(executed).toEqual([`${session.id}:first`])
    expect(session.toolModes.value).toEqual({ fetch: 'ask' })
  })

  it('waits for persistence and never approves a different chat after a tab switch', async () => {
    const saving = deferred()
    vi.mocked(AbeleConfig.getInstance().saveSettings).mockReturnValue(saving.promise)
    await start(call('first'))
    await button('Allow this address for these keys').trigger('click')
    await nextTick()
    expect(executed).toEqual([])
    const other = makeSession()
    planned = [call('other', { ...request, url: 'https://other.example/data' })]
    await other.sendMessage('Use a different sample request')
    active.value = other
    await nextTick()
    saving.resolve()
    await flushPromises()
    expect(executed).toEqual([])
    expect(session.pendingToolCalls.value[0].id).toBe('first')
    expect(other.pendingToolCalls.value[0].id).toBe('other')
  })

  it.each(['args', 'key', 'reject', 'replacement'])(
    'does not settle a stale %s while trust is saving',
    async (change) => {
      const saving = deferred()
      vi.mocked(AbeleConfig.getInstance().saveSettings).mockReturnValue(saving.promise)
      await start(call('first'))
      await button('Allow this address for these keys').trigger('click')
      if (change === 'args')
        session.pendingToolCalls.value[0].arguments.url = 'https://other.example/data'
      if (change === 'key') AbeleConfig.getInstance().ai.secrets[0].keyId = 'replacement-key'
      if (change === 'replacement')
        session.pendingToolCalls.value = [
          {
            ...session.pendingToolCalls.value[0],
            arguments: { ...request, body: 'replacement request' },
          },
        ]
      if (change === 'reject') await session.rejectToolCall()
      saving.resolve()
      await flushPromises()
      expect(executed).toEqual([])
    }
  )

  it('ignores duplicate trust clicks while saving and settles only after success', async () => {
    const saving = deferred()
    vi.mocked(AbeleConfig.getInstance().saveSettings).mockReturnValue(saving.promise)
    await start(call('first'))
    const trust = button('Allow this address for these keys')
    await trust.trigger('click')
    await trust.trigger('click')
    await flushPromises()
    expect(executed).toEqual([])
    expect(AbeleConfig.getInstance().saveSettings).toHaveBeenCalledTimes(1)
    saving.resolve()
    await flushPromises()
    expect(executed).toEqual([`${session.id}:first`])
  })

  it.each([new Error('Synthetic save failure'), 'Synthetic save failure'])(
    'keeps the call unexecuted and displays failed trust persistence: %s',
    async (error) => {
      vi.mocked(AbeleConfig.getInstance().saveSettings).mockRejectedValue(error)
      await start(call('first'))
      await button('Allow this address for these keys').trigger('click')
      await flushPromises()
      expect(executed).toEqual([])
      expect(view.text()).toContain('Could not save key permission')
      expect(view.text()).not.toContain('Synthetic save failure')
      expect(needsSecretApproval('fetch', request)).toBe(true)
    }
  )

  it('keeps Send once local to its call, leaving another key request and chat pending', async () => {
    const other = makeSession()
    planned = [call('other')]
    await other.sendMessage('Use another sample request')
    await start(call('first'), call('second'))
    await button('Approve').trigger('click')
    await flushPromises()
    expect(executed).toEqual([`${session.id}:first`])
    expect(session.pendingToolCalls.value[0].id).toBe('second')
    expect(other.pendingToolCalls.value[0].id).toBe('other')
    expect(needsSecretApproval('fetch', request)).toBe(true)
    expect(AbeleConfig.getInstance().ai.secrets[0].allowedOrigins).toBeUndefined()
  })
})
