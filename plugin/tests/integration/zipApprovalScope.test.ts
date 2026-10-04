import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { Message, ToolCallContent } from '@/ai/client'
import { toolPolicy } from '@/ai/interceptor/policy'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

const policy = vi.hoisted(() => ({ approve: vi.fn() }))
vi.mock('@/ai/interceptor/runScript', async (original) => ({
  ...(await original<typeof import('@/ai/interceptor/runScript')>()),
  runInterceptorScript: async (
    _name: string,
    input: { message: { text: string; attachments: string[] } }
  ) => ({
    kind: 'send',
    text: input.message.text,
    attachments: input.message.attachments,
    rewritten: false,
    policy: toolPolicy({ approve: policy.approve, deny: [] }, 'Sample ZIP policy'),
  }),
}))
let planned: ToolCallContent[] = []
vi.mock('@/ai/client/OpenAIClient', () => ({
  OpenAIClient: class {
    async *stream(_model: unknown, _prompt: string, messages: Message[], tools: unknown[]) {
      const hasResult = messages.some((message) => message.role === 'toolResult')
      const calls = tools?.length && !hasResult ? planned : []
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
const sourcePath = 'Notes/sample.md'
const originalBytes = new TextEncoder().encode('sample\r\n')
const provider = {
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
const call = (id: string, name: string, args: Record<string, unknown>): ToolCallContent => ({
  type: 'toolCall',
  id,
  name,
  arguments: args,
})
type Route = 'manual' | 'interceptor-loop' | 'interceptor-queue'
const routes: Route[] = ['manual', 'interceptor-loop', 'interceptor-queue']
let app: App
const sessions: ChatSession[] = []
beforeEach(() => {
  app = useVault([
    { path: sourcePath, content: 'sample\r\n' },
    { path: 'Private/sample.zip', content: 'existing archive bytes' },
    { path: 'Private/sample.md', content: 'unselected note' },
    { path: 'Private/hidden.bin', content: 'unselected binary' },
  ]) as unknown as App
  ;(app.vault.getAbstractFileByPath(sourcePath) as TFile).stat.size = originalBytes.length
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    providers: [provider],
  }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue()
  policy.approve
    .mockReset()
    .mockImplementation((request: { name: string }) => (request.name === 'zip' ? true : undefined))
  planned = []
})
afterEach(() => {
  sessions.forEach((session) => session.destroy())
  sessions.length = 0
  ChatService.getInstance().destroy()
  ChangeTracker.get()?.uninstall()
  vi.restoreAllMocks()
})
function owner(route: Route) {
  const agent = AgentRegistry.getInstance().create({
    name: 'Sample ZIP owner',
    providerId: provider.id,
    modelId: 'sample-model',
    permissionMode: 'confirm-all',
    scope: [{ type: 'file', path: sourcePath }],
    ...(route === 'manual' ? {} : { interceptorScript: 'Sample ZIP policy' }),
  })
  const session = new ChatSession(ChatService.getInstance(), undefined, { agentId: agent.id })
  sessions.push(session)
  vi.spyOn(session, 'save').mockResolvedValue()
  vi.spyOn(session, 'flush').mockResolvedValue()
  return session
}
function plan(route: Route, args: Record<string, unknown>) {
  planned = [
    ...(route === 'interceptor-queue'
      ? [call('sample-head', 'remember', { text: 'Use concise sample answers' })]
      : []),
    call('sample-zip', 'zip', args),
  ]
}
async function runApproved(session: ChatSession, route: Route) {
  if (route === 'interceptor-loop') return session.sendMessage('Pack the selected sample')
  await session.sendMessage('Pack the selected sample')
  expect(session.pendingToolCalls.value[0]?.name).toBe(route === 'manual' ? 'zip' : 'remember')
  return session.approveToolCall()
}

for (const route of routes) {
  it.each([
    'collision',
    'invalid-path',
    'denied-selection',
    'native-failure',
    'pre-issuance-stop',
  ] as const)(`${route} approval of failed %s ZIP never widens scope`, async (fault) => {
    const session = owner(route)
    const args = {
      path:
        fault === 'collision'
          ? 'Private/sample.zip'
          : fault === 'invalid-path'
            ? 'Private/sample.md'
            : 'Exports/new.zip',
      files: [{ path: sourcePath }],
    }
    if (fault === 'denied-selection') args.files.push({ path: 'Private/hidden.bin' })
    plan(route, args)
    const before = JSON.parse(JSON.stringify(session.scopeResolver.entries.value))
    const read = vi.spyOn(app.vault, 'readBinary')
    const write = vi.spyOn(app.vault, 'createBinary')
    const folders = vi.spyOn(app.vault, 'createFolder')
    if (fault === 'native-failure')
      write.mockRejectedValueOnce(new Error('Sample native save failure'))
    const gate = deferred<ArrayBuffer>()
    if (fault === 'pre-issuance-stop') read.mockReturnValueOnce(gate.promise)
    const operation = runApproved(session, route)
    if (fault === 'pre-issuance-stop') {
      await vi.waitFor(() => expect(read).toHaveBeenCalled())
      if (route === 'interceptor-loop') session.abort()
      else session.abortToolExecution()
      gate.resolve(originalBytes.slice().buffer)
    }
    await operation
    expect(session.scopeResolver.entries.value).toEqual(before)
    for (const path of [
      'Private/sample.zip',
      'Private/sample.md',
      'Private/hidden.bin',
      'Exports/new.zip',
      'Exports',
    ])
      expect(session.scopeResolver.isInScope(path), path).toBe(false)
    if (fault !== 'native-failure') {
      expect(write).not.toHaveBeenCalled()
      expect(folders).not.toHaveBeenCalled()
    }
    if (['collision', 'invalid-path', 'denied-selection'].includes(fault))
      expect(read).not.toHaveBeenCalled()
    if (fault !== 'pre-issuance-stop') {
      const result = session.messages.value.find((message) => message.toolName === 'zip')
      expect(result?.toolStatus).toBe('rejected')
      expect(result?.toolResult).toMatch(
        fault === 'collision'
          ? /exists/
          : fault === 'invalid-path'
            ? /exact safe \.zip/
            : fault === 'denied-selection'
              ? /not available in this scope/
              : /issued.*did not confirm/
      )
      expect(result?.toolDiff).toBeUndefined()
    }
  })
  it(`${route} grants only the saved ZIP after native settlement, never source folders or parents`, async () => {
    const session = owner(route)
    plan(route, { path: 'Exports/Nested/new.zip', files: [{ path: sourcePath }] })
    const before = JSON.parse(JSON.stringify(session.scopeResolver.entries.value))
    const gate = deferred()
    const native = app.vault.createBinary.bind(app.vault)
    const write = vi.spyOn(app.vault, 'createBinary').mockImplementationOnce(async (...args) => {
      await gate.promise
      return native(...args)
    })
    const operation = runApproved(session, route)
    await vi.waitFor(() => expect(write).toHaveBeenCalled())
    expect(session.scopeResolver.entries.value).toEqual(before)
    gate.resolve()
    await operation
    expect(session.scopeResolver.entries.value).toEqual([
      ...before,
      { type: 'file', path: 'Exports/Nested/new.zip' },
    ])
    expect(session.scopeResolver.isInScope('Exports/Nested/new.zip')).toBe(true)
    for (const path of ['Notes', 'Exports', 'Exports/Nested', 'Private/hidden.bin'])
      expect(session.scopeResolver.isInScope(path), path).toBe(false)
    expect(
      session.messages.value.find((message) => message.toolName === 'zip')?.toolResult
    ).toContain('Saved ZIP')
    expect(session.touched.value).toEqual([])
  })
}

it('preserves ordinary approval widening for existing non-ZIP read tools', async () => {
  const session = owner('manual')
  planned = [call('sample-read', 'read', { path: 'Private/sample.md' })]
  await session.sendMessage('Read the selected private sample')
  expect(session.scopeResolver.isInScope('Private/sample.md')).toBe(false)
  await session.approveToolCall()
  expect(session.scopeResolver.isInScope('Private/sample.md')).toBe(true)
  expect(
    session.messages.value.find((message) => message.toolName === 'read')?.toolResult
  ).toContain('unselected note')
})
