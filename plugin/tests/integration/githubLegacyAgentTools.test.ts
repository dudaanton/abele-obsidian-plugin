import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgent } from '@/ai/agents/types'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { createAgentTools } from '@/ai/tools'
import { createGithubTools } from '@/ai/tools/github'
import type { AgentTool, ModelConfig } from '@/ai/client'
import { AgentLoop } from '@/ai/client/AgentLoop'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { githubSettingsFrom } from '@/github/settings'
import { useVault } from '../helpers/testEnv'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/github/transport', () => ({ singleHopRequest: request }))
const sessions: ChatSession[] = []
function newSession(options?: ConstructorParameters<typeof ChatSession>[1]) {
  const session = new ChatSession(ChatService.getInstance(), options)
  sessions.push(session)
  return session
}
afterEach(() => {
  for (const session of sessions) session.destroy()
  sessions.length = 0
  vi.restoreAllMocks()
})

const server = 'https://git.example.test'
const item = `${server}/sample/widgets/pull/12`
const oldAgent = () => {
  const agent = createAgent({ id: 'sample-existing', name: 'Sample existing' })
  // A saved agent from before connection permissions had no map at all.
  delete agent.githubConnections
  return agent
}
const load = (upgraded = false, map?: Record<string, 'off' | 'ask' | 'auto'>) => {
  const agent = oldAgent()
  if (map !== undefined) agent.githubConnections = map
  const legacy = { enabled: true, server, keyId: 'sample-old-slot' }
  const config = AbeleConfig.getInstance()
  config.applySettings({
    ai: { ...DEFAULT_AI_SETTINGS, agents: [agent], defaultAgentId: agent.id },
    github: upgraded ? githubSettingsFrom(legacy) : legacy,
  } as Parameters<typeof config.applySettings>[0])
  AgentRegistry.getInstance().notifyConfigReloaded()
  return agent.id
}
const tool = (tools: AgentTool[], name: string) => tools.find((t) => t.name === name)!
const sessionTools = (session: ChatSession) =>
  (session as unknown as { getTools(): AgentTool[] }).getTools()

beforeEach(() => {
  const app = useVault([])
  AgentRegistry.destroy()
  app.secretStorage.setSecret('sample-old-slot', 'invented-legacy-token')
  request.mockReset().mockImplementation(async (r) => ({
    status: 200,
    headers: {},
    text: '',
    arrayBuffer: new ArrayBuffer(0),
    json: r.url.includes('/files')
      ? [
          {
            filename: 'src/sample.ts',
            status: 'modified',
            additions: 1,
            deletions: 0,
            patch: '+sample',
          },
        ]
      : /comments|reviews|timeline/.test(r.url)
        ? []
        : {
            number: 12,
            title: 'Sample change',
            state: 'open',
            labels: [],
            body: 'Sample body',
            user: { login: 'sample-author' },
            html_url: item,
            created_at: '2026-01-01',
          },
  }))
})

describe('existing GitHub credentials through the execution tool chain', () => {
  it.each([false, true])(
    'preserves legacy access when connections have already been migrated: %s',
    async (upgraded) => {
      const id = load(upgraded)
      const chat = newSession({ agentId: id })
      for (const name of ['github_read', 'github_pr_files']) {
        const result = await tool(sessionTools(chat), name).execute('sample-chat', {
          item,
          page: 1,
        })
        expect(JSON.stringify(result)).toContain(
          name === 'github_read' ? 'Sample change' : 'src/sample.ts'
        )
      }
      expect(request).toHaveBeenCalled()
      expect(request.mock.calls.every(([r]) => r.url.startsWith(`${server}/api/`))).toBe(true)
      expect(
        request.mock.calls.every(
          ([r]) => r.headers?.Authorization === 'Bearer invented-legacy-token'
        )
      ).toBe(true)
      const saved = AbeleConfig.getInstance().exportSettings()
      AbeleConfig.getInstance().applySettings(saved)
      expect(AgentRegistry.getInstance().get(id)?.githubConnections).toEqual({
        'github-legacy': 'auto',
      })
    }
  )

  it('uses the default agent for a chat without an explicit agent and the target for an unattended run', async () => {
    const id = load()
    const chat = newSession()
    const run = newSession({ agentId: id, kind: 'run' })
    for (const session of [chat, run]) {
      expect(
        JSON.stringify(await tool(sessionTools(session), 'github_read').execute('sample', { item }))
      ).toContain('Sample change')
    }
    // This is also the factory used by script/automation agent runs.
    expect(
      JSON.stringify(
        await tool(createAgentTools({ agentId: id }), 'github_pr_files').execute('sample-script', {
          item,
        })
      )
    ).toContain('src/sample.ts')
  })

  it('a script or automation runs its target agent through the unattended tool loop', async () => {
    const id = load(true)
    const registry = AgentRegistry.getInstance()
    vi.spyOn(registry, 'resolveModel').mockReturnValue({ id: 'sample-model' } as ModelConfig)
    vi.spyOn(AgentLoop.prototype, 'run').mockImplementation(async (options) => {
      const verdict = await options.beforeToolCall?.('github_pr_files', 'sample-script', { item })
      if (verdict?.block) throw new Error(verdict.reason)
      const result = await tool(options.tools!, 'github_pr_files').execute('sample-script', {
        item,
      })
      return { messages: [{ role: 'assistant', content: result.content }] } as Awaited<
        ReturnType<AgentLoop['run']>
      >
    })
    const script = buildScriptContext({
      params: {},
      signal: new AbortController().signal,
      logs: [],
    })
    expect(await script.agent('Read the sample pull request', { agent: id })).toContain(
      'src/sample.ts'
    )
    registry.get(id)!.githubConnections = { 'github-legacy': 'off' }
    request.mockClear()
    await expect(script.agent('Read the sample pull request', { agent: id })).rejects.toThrow(
      /permitted|disabled/
    )
    expect(request).not.toHaveBeenCalled()
  })

  it('the pre-agent default keeps the original GitHub credential', async () => {
    load()
    const config = AbeleConfig.getInstance()
    const settings = config.exportSettings()
    config.applySettings({
      ...settings,
      ai: { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' },
    })
    const chat = newSession()
    expect(
      JSON.stringify(
        await tool(sessionTools(chat), 'github_read').execute('sample-default', { item })
      )
    ).toContain('Sample change')
  })

  it.each([{}, { 'github-legacy': 'off' as const }])(
    'does not replace an explicit connection map %j',
    async (map) => {
      const id = load(true, map)
      await expect(
        tool(createAgentTools({ agentId: id }), 'github_read').execute('sample', { item })
      ).rejects.toThrow(/permitted|disabled/)
      expect(request).not.toHaveBeenCalled()
      expect(AgentRegistry.getInstance().get(id)?.githubConnections).toEqual(map)
    }
  )

  it('retains Ask and refuses it unattended; approval cannot persist or override Off', async () => {
    const id = load(true, { 'github-legacy': 'ask' })
    await expect(
      tool(createAgentTools({ agentId: id }), 'github_read').execute('sample', { item })
    ).rejects.toThrow(/approval/)
    const approve = vi.fn(async () => true)
    expect(
      JSON.stringify(
        await tool(
          createAgentTools({ agentId: id, githubApproval: approve }),
          'github_read'
        ).execute('sample', { item })
      )
    ).toContain('Sample change')
    expect(approve).toHaveBeenCalledOnce()
    expect(AgentRegistry.getInstance().get(id)?.githubConnections?.['github-legacy']).toBe('ask')
  })

  it('does not grant a newly created agent or a newly added connection the legacy credential', async () => {
    load(true)
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({ name: 'Sample new' })
    const config = AbeleConfig.getInstance()
    config.applySettings(config.exportSettings())
    expect(registry.get(agent.id)?.githubConnections).toEqual({})
    await expect(
      tool(createAgentTools({ agentId: agent.id }), 'github_read').execute('sample', { item })
    ).rejects.toThrow(/permitted/)
    config.github.connections.push({
      id: 'sample-new',
      name: 'New connection',
      server,
      keyId: 'sample-old-slot',
      owners: [],
      isDefault: false,
    })
    await expect(
      tool(createAgentTools({ agentId: 'sample-existing' }), 'github_read').execute('sample', {
        item,
        connection: 'sample-new',
      })
    ).rejects.toThrow(/disabled/)
    expect(request).not.toHaveBeenCalled()
  })

  it('does not grant nonlegacy accounts or resurrect an explicitly deleted credential', () => {
    load(true)
    const config = AbeleConfig.getInstance()
    const saved = config.exportSettings()
    const agent = oldAgent()
    config.applySettings({
      ...saved,
      ai: { ...saved.ai, agents: [agent] },
      github: { ...saved.github!, connections: [] },
    })
    expect(config.github.connections).toEqual([])
    expect(AgentRegistry.getInstance().get(agent.id)?.githubConnections).toEqual({})
  })

  it('uses each call-local agent without borrowing a selected chat or concurrent invocation', async () => {
    const id = load(true, { 'github-legacy': 'auto' })
    const denied = AgentRegistry.getInstance().create({
      name: 'Sample denied',
      githubConnections: { 'github-legacy': 'off' },
    })
    const tools = createAgentTools()
    const context = (agentId: string) => ({
      scope: new ScopeResolver(),
      agentId,
      interactive: false,
    })
    const reading = tool(tools, 'github_read').execute(
      'sample-allowed',
      { item },
      undefined,
      context(id)
    )
    await expect(
      tool(tools, 'github_pr_files').execute(
        'sample-denied',
        { item },
        undefined,
        context(denied.id)
      )
    ).rejects.toThrow(/permitted|disabled/)
    expect(JSON.stringify(await reading)).toContain('Sample change')
    expect(
      request.mock.calls.every(([r]) => r.headers?.Authorization === 'Bearer invented-legacy-token')
    ).toBe(true)
  })

  it('keeps an absent execution identity denied even with a migrated default agent', async () => {
    load()
    await expect(
      tool(createGithubTools(), 'github_read').execute('sample', { item })
    ).rejects.toThrow(/permitted/)
    await expect(
      tool(createAgentTools(), 'github_read').execute('sample', { item })
    ).rejects.toThrow(/permitted/)
    expect(request).not.toHaveBeenCalled()
  })
})
