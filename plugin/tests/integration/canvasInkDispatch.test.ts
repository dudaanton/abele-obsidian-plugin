import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import type { Message, ModelConfig } from '@/ai/client'
import { createCanvasTools } from '@/ai/tools/CanvasTools'
import { runSubAgent } from '@/ai/SubAgentRunner'
import { createAgent } from '@/ai/agents/types'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { ObsidianCanvasStore } from '@/canvas/obsidianStore'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

let request: Record<string, unknown>, app: App
const path = 'sample.canvas'
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(_model: ModelConfig, _system: string, messages: Message[]) {
      const result = messages.findLast((m) => m.role === 'toolResult')
      yield {
        type: 'done',
        message: {
          role: 'assistant',
          content: result
            ? [{ type: 'text', text: result.content.map((c) => c.text).join('') }]
            : [
                {
                  type: 'toolCall',
                  id: 'sample-ink-call',
                  name: 'canvas_edit',
                  arguments: request,
                },
              ],
          stopReason: result ? 'stop' : 'toolUse',
          timestamp: 1,
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
      contextWindow: 10000,
      maxTokens: 100,
      supportsReasoning: false,
    },
  ],
}
const model: ModelConfig = {
  id: 'sample-model',
  name: 'Sample model',
  baseUrl: provider.baseUrl,
  apiKey: '',
  maxTokens: 100,
  supportsReasoning: false,
}
const source = () => app.vault.read(app.vault.getAbstractFileByPath(path) as TFile)
destroyChatsAfterEach()
beforeEach(async () => {
  app = useVault([{ path, content: JSON.stringify({ nodes: [], edges: [] }) }]) as unknown as App
  Object.assign(app, { workspace: { getLeavesOfType: () => [] } })
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = structuredClone({
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  })
  request = {
    path,
    revision: (await new ObsidianCanvasStore(app).snapshot(path)).revision,
    ops: [
      {
        op: 'add_ink',
        stroke: { version: 1, id: 'agent-ink', tool: 'pen', points: [0, 0, 0.5, 100, 20, 0.8] },
      },
    ],
  }
})
afterEach(() => vi.restoreAllMocks())
function session(mode: 'off' | 'ask' | 'auto', kind: 'chat' | 'run' = 'chat') {
  const agent = AgentRegistry.getInstance().create({
    name: 'Sample artist',
    providerId: provider.id,
    modelId: 'sample-model',
    permissionMode: 'allow-all',
    toolModes: { canvas_edit: mode },
    toolDiscovery: 'all',
  })
  const chat = new ChatSession(ChatService.getInstance(), undefined, { agentId: agent.id, kind })
  chat.scopeResolver.setFullVaultAccess(true)
  vi.spyOn(chat, 'save').mockResolvedValue()
  const summarizer = (
    chat as unknown as {
      summarizer: { generateTitle(): Promise<void>; autoCompactIfNeeded(): Promise<void> }
    }
  ).summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue()
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue()
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
  return chat
}

describe('ink through real chat dispatch', () => {
  it('Ask waits even under allow-all, then one approved batch writes one shared undo item', async () => {
    const lease = await new ObsidianCanvasStore(app).open(
      app.vault.getAbstractFileByPath(path) as TFile,
      {}
    )
    request.revision = (await new ObsidianCanvasStore(app).snapshot(path)).revision
    const chat = session('ask'),
      before = await source()
    try {
      await chat.sendMessage('Add a pen stroke')
      expect(chat.pendingToolCalls.value.map((c) => c.name)).toEqual(['canvas_edit'])
      expect(await source()).toBe(before)
      expect(lease.document.session.history.undo).toBe(0)
      await chat.approveToolCall()
      expect(chat.pendingToolCalls.value).toEqual([])
      expect(JSON.parse(await source()).abele.ink).toMatchObject([
        { id: 'agent-ink', color: '', size: 2.4 },
      ])
      expect(lease.document.session.history.undo).toBe(1)
    } finally {
      lease.release()
    }
  })
  it('Off remains unavailable even when the model requests the edit', async () => {
    const chat = session('off'),
      before = await source()
    await chat.sendMessage('Add a pen stroke')
    expect(chat.pendingToolCalls.value).toEqual([])
    expect(await source()).toBe(before)
  })
  it('an approved stroke cannot publish an active human gesture', async () => {
    const store = new ObsidianCanvasStore(app),
      lease = await store.open(app.vault.getAbstractFileByPath(path) as TFile, {})
    request.revision = (await store.snapshot(path)).revision
    const chat = session('ask'),
      before = await source()
    try {
      await chat.sendMessage('Add a pen stroke')
      lease.document.beginDraft()
      await chat.approveToolCall()
      expect(await source()).toBe(before)
      expect(chat.lastAssistantText()).toMatch(/busy|pending|changed/i)
      expect(lease.document.session.busy).toBe(true)
      expect(lease.document.session.history.undo).toBe(0)
    } finally {
      lease.document.discardDraft()
      lease.release()
    }
  })
  it.each(['off', 'ask', 'auto'] as const)(
    'sub-agent %s respects the same ink tool permission',
    async (mode) => {
      const scope = new ScopeResolver()
      scope.setFullVaultAccess(true)
      const before = await source()
      const result = await runSubAgent(
        { systemPrompt: '', userMessage: 'Add a pen stroke', tools: createCanvasTools(), model },
        createAgent({ permissionMode: 'allow-all', toolModes: { canvas_edit: mode } }),
        scope
      )
      if (mode === 'auto') expect(JSON.parse(await source()).abele.ink[0].id).toBe('agent-ink')
      else {
        expect(await source()).toBe(before)
        expect(result).toMatch(mode === 'ask' ? /approval/ : /not enabled/)
      }
    }
  )
})
