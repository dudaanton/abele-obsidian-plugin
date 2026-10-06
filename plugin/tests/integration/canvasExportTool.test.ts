import { beforeEach, expect, it, vi } from 'vitest'
import { type App, TFile } from 'obsidian'
import { createCanvasTools } from '@/ai/tools/CanvasTools'
import { createAgentTools } from '@/ai/tools'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { CANVAS_TOOL_MODES, DEFAULT_AI_SETTINGS } from '@/ai/types'
import { createAgent } from '@/ai/agents/types'
import { migrateAgents } from '@/ai/agents/migration'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { subAgentRefusal } from '@/ai/SubAgentRunner'
import { buildFakeVault } from '../helpers/fakeVault'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AgentLoop } from '@/ai/client/AgentLoop'
import type { AgentTool } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

destroyChatsAfterEach()

const delivery = vi.hoisted(() => vi.fn())
vi.mock('@/canvas/exportAdapter', () => ({
  exportCanvas: delivery,
  exportPath: (path: string) => path,
}))
let scope: ScopeResolver
const call = (params: unknown) =>
  createCanvasTools()
    .find((t) => t.name === 'canvas_export')!
    .execute('sample', params, undefined, { scope, interactive: true })
beforeEach(() => {
  AbeleConfig.getInstance().ai = JSON.parse(JSON.stringify(DEFAULT_AI_SETTINGS))
  ;(GlobalStore.getInstance() as unknown as { _app: App })._app = buildFakeVault(
    []
  ) as unknown as App
  scope = new ScopeResolver()
  scope.setFullVaultAccess(false)
  scope.entries.value = [{ type: 'file', path: 'sample.canvas' }]
  delivery.mockResolvedValue({
    file: Object.assign(new TFile(), { path: 'sample.pdf' }),
    revision: 'sample-revision',
    visible: ['near', 'far'],
    warnings: [],
    rasterBacked: true,
  })
})
it('registers an independent Ask permission, preserving explicit Off during migration', () => {
  expect(createAgentTools().some((t) => t.name === 'canvas_export')).toBe(true)
  expect(CANVAS_TOOL_MODES.canvas_export).toBe('ask')
  const ai = JSON.parse(JSON.stringify(DEFAULT_AI_SETTINGS))
  const agent = createAgent({ toolModes: { canvas_export: 'off' } })
  ai.agents = [agent]
  migrateAgents(ai)
  expect(ai.agents.find((a: { id: string }) => a.id === agent.id).toolModes.canvas_export).toBe(
    'off'
  )
  for (const mode of ['off', 'ask'] as const)
    expect(
      subAgentRefusal(
        'canvas_export',
        { path: 'sample.canvas' },
        createAgent({ permissionMode: 'allow-all', toolModes: { canvas_export: mode } }),
        scope
      )
    ).toMatch(/not enabled|approval/)
  expect(
    subAgentRefusal(
      'canvas_export',
      { path: 'outside.canvas' },
      createAgent({ toolModes: { canvas_export: 'auto' } }),
      scope
    )
  ).toMatch(/scope/)
})
it('returns the captured revision, scopes assets, and adds only a successfully created output to scope', async () => {
  const result = await call({ path: 'sample.canvas', output: 'sample.pdf', format: 'pdf' })
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    path: 'sample.pdf',
    source: 'sample.canvas',
    revision: 'sample-revision',
    visible: ['near', 'far'],
  })
  expect(delivery.mock.calls[0][1].inScope('outside.md')).toBe(false)
  expect(scope.isInScope('sample.pdf')).toBe(true)
  delivery.mockRejectedValueOnce(new Error('Sample write failure'))
  await expect(
    call({ path: 'sample.canvas', output: 'failed.png', format: 'png' })
  ).rejects.toThrow()
  expect(scope.isInScope('failed.png')).toBe(false)
})
it('dispatches an approved export through the owning chat and keeps Off unavailable', async () => {
  useVault([])
  const config = AbeleConfig.getInstance()
  config.ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    providers: [
      {
        id: 'sample-provider',
        name: 'Sample',
        baseUrl: 'https://example.invalid/v1',
        apiKeyId: '',
        models: [
          {
            id: 'sample-model',
            name: 'Sample',
            contextWindow: 10000,
            maxTokens: 100,
            supportsReasoning: false,
          },
        ],
      },
    ],
  }
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Sample export helper',
    providerId: 'sample-provider',
    modelId: 'sample-model',
    permissionMode: 'allow-all',
    toolModes: { canvas_export: 'ask' },
  })
  registry.setDefault(agent.id)
  const session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockResolvedValue(undefined)
  vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (options) => ({
    messages: options.messages,
  }))
  vi.spyOn(ChatService.getInstance(), 'getSystemPrompt').mockResolvedValue('')
  const summarizer = (
    session as unknown as {
      summarizer: { generateTitle(): Promise<void>; autoCompactIfNeeded(): Promise<void> }
    }
  ).summarizer
  vi.spyOn(summarizer, 'generateTitle').mockResolvedValue(undefined)
  vi.spyOn(summarizer, 'autoCompactIfNeeded').mockResolvedValue(undefined)
  session.scopeResolver.setFullVaultAccess(false)
  session.scopeResolver.entries.value = [{ type: 'file', path: 'sample.canvas' }]
  const args = { path: 'sample.canvas', output: 'sample.pdf', format: 'pdf' }
  expect(session.needsApproval('canvas_export', args)).toBe(true)
  expect(delivery).not.toHaveBeenCalled()
  session.pendingToolCalls.value = [
    { type: 'toolCall', id: 'sample-approved', name: 'canvas_export', arguments: args },
  ]
  await session.approveToolCall()
  expect(delivery).toHaveBeenCalledOnce()
  expect(delivery.mock.calls[0][1].inScope('outside.md')).toBe(false)
  expect(session.scopeResolver.isInScope('sample.pdf')).toBe(true)
  session.toolModes.value.canvas_export = 'off'
  expect(
    (session as unknown as { getTools(): AgentTool[] })
      .getTools()
      .some((tool) => tool.name === 'canvas_export')
  ).toBe(false)
  session.destroy()
})
it('refuses an unauthorized source before export and never offers viewport or step arguments', async () => {
  await expect(
    call({ path: 'outside.canvas', output: 'sample.pdf', format: 'pdf' })
  ).rejects.toThrow(/scope/)
  await expect(
    call({ path: 'sample.canvas', output: 'sample.pdf', format: 'pdf', step: 1 })
  ).rejects.toThrow()
  expect(delivery).not.toHaveBeenCalled()
})
