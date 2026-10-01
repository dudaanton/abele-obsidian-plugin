import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import {
  boundRunToParent,
  canDelegate,
  MAX_DELEGATE_DEPTH,
  MAX_DELEGATE_ITEMS,
  MAX_RUNS_PER_CHAT,
  DelegateRun,
} from '@/ai/DelegateRun'
import { createDelegateTool } from '@/ai/tools/DelegateTool'
import { RunStorage } from '@/ai/RunStorage'
import type { AgentDefinition } from '@/ai/agents/types'
import type { AgentTool } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

destroyChatsAfterEach()
const agent = (patch: Partial<AgentDefinition> = {}) => AgentRegistry.getInstance().create(patch)
const chat = (target: AgentDefinition) =>
  new ChatSession(ChatService.getInstance(), undefined, { agentId: target.id })
const child = (target: AgentDefinition, parent: ChatSession) => {
  const run = new ChatSession(ChatService.getInstance(), undefined, {
    kind: 'run',
    agentId: target.id,
    depth: parent.depth + 1,
    root: parent.root,
  })
  boundRunToParent(run, parent)
  return run
}
beforeEach(() => {
  vi.restoreAllMocks()
  useVault([
    { path: 'Project/Visible.md', content: 'visible' },
    { path: 'Project/Child.md', content: 'child' },
    { path: 'Separate/Hidden.md', content: 'hidden' },
    {
      path: 'Skills/Guide.md',
      content: 'guide instructions',
      frontmatter: { type: 'abele-skill', name: 'Guide', description: 'Guide procedure' },
    },
  ])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    agents: [],
    defaultAgentId: '',
    skillsFolder: 'Skills',
  }
})

describe('delegated access ceiling', () => {
  it('restricts a full-vault target to the parent and keeps the ceiling after grants and invalidation', () => {
    const parent = chat(agent({ scope: [{ type: 'folder', path: 'Project' }] }))
    const run = child(agent({ fullVaultAccess: true }), parent)
    expect(run.scopeResolver.getAccessiblePaths()).toEqual([
      'Project/Child.md',
      'Project/Visible.md',
    ])
    expect(run.scopeResolver.isInScope('Separate/Hidden.md')).toBe(false)
    expect(run.scopeResolver.isFolderInScope('Separate')).toBe(false)
    expect(run.scopeResolver.filterInScope(['Project/Visible.md', 'Separate/Hidden.md'])).toEqual([
      'Project/Visible.md',
    ])
    run.scopeResolver.addFile('Separate/Hidden.md')
    run.scopeResolver.invalidate()
    expect(run.scopeResolver.isInScope('Separate/Hidden.md')).toBe(false)
  })
  it('intersects nonempty scopes, and inherits when the target has none', () => {
    const parent = chat(agent({ scope: [{ type: 'folder', path: 'Project' }] }))
    const narrow = child(
      agent({
        scope: [
          { type: 'file', path: 'Project/Visible.md' },
          { type: 'folder', path: 'Separate' },
        ],
      }),
      parent
    )
    expect(narrow.scopeResolver.getAccessiblePaths()).toEqual(['Project/Visible.md'])
    expect(child(agent(), parent).scopeResolver.getAccessiblePaths()).toEqual([
      'Project/Child.md',
      'Project/Visible.md',
    ])
  })
  it('uses the stricter permissions and tool modes, including chat overrides', () => {
    const parent = chat(
      agent({ permissionMode: 'allow-all', toolModes: { fetch: 'auto', eval_js: 'auto' } })
    )
    parent.permissionMode.value = 'confirm-all'
    parent.toolModes.value = { fetch: 'ask', web_search: 'auto' }
    const run = child(
      agent({
        permissionMode: 'allow-all',
        toolModes: { fetch: 'auto', web_search: 'auto', eval_js: 'auto' },
      }),
      parent
    )
    expect(run.permissionMode.value).toBe('confirm-all')
    expect(run.toolModes.value).toEqual({ fetch: 'ask', web_search: 'auto', eval_js: 'off' })
  })
  it('also intersects per-connection GitHub rights from newer agent settings', () => {
    const parent = chat(agent({ githubConnections: { sample: 'off', shared: 'ask' } }))
    const run = child(
      agent({ githubConnections: { sample: 'auto', shared: 'auto', extra: 'auto' } }),
      parent
    )
    expect(run.githubAgent()?.githubConnections).toEqual({
      sample: 'off',
      shared: 'ask',
      extra: 'off',
    })
  })
  it('applies the ceiling in real delegate branches before they start', async () => {
    const parent = chat(
      agent({ scope: [{ type: 'folder', path: 'Project' }], toolModes: { fetch: 'ask' } })
    )
    const target = agent({
      name: 'Sample helper',
      fullVaultAccess: true,
      permissionMode: 'allow-all',
      toolModes: { fetch: 'auto' },
    })
    vi.spyOn(parent, 'flush').mockResolvedValue(undefined)
    vi.spyOn(RunStorage.getInstance(), 'save').mockResolvedValue(null)
    const reached: string[][] = []
    vi.spyOn(ChatSession.prototype, 'sendMessage').mockImplementation(async function (
      this: ChatSession
    ) {
      reached.push(this.scopeResolver.getAccessiblePaths())
      expect(this.permissionMode.value).toBe('confirm-all')
      expect(this.toolModes.value.fetch).toBe('ask')
    })
    await createDelegateTool().execute(
      'sample',
      { agent: target.name, task: 'test', items: ['first', 'second'] },
      undefined,
      { scope: parent.scopeResolver, session: parent, interactive: true }
    )
    expect(reached).toEqual([
      ['Project/Child.md', 'Project/Visible.md'],
      ['Project/Child.md', 'Project/Visible.md'],
    ])
  })
  it('cannot use a folder skill that the parent disabled', () => {
    const parent = chat(agent({ skillsMode: 'none' }))
    const run = child(agent(), parent)
    expect(run.needsApproval('skill', { name: 'Guide' })).toBe(true)
    const tools = (run as unknown as { getTools(): AgentTool[] }).getTools()
    expect(tools.find((t) => t.name === 'skill')!.description).not.toContain('Guide procedure')
  })
})

describe('delegation resource limits', () => {
  it('counts depth from the root and retains the narrowest chain limit', () => {
    const parent = chat(agent({ maxDelegateDepth: 1 }))
    expect(canDelegate(parent)).toBe(true)
    expect(canDelegate(child(agent({ maxDelegateDepth: 20 }), parent))).toBe(false)
    let run = chat(agent({ maxDelegateDepth: 20 }))
    for (let n = 0; n < MAX_DELEGATE_DEPTH; n++) run = child(agent({ maxDelegateDepth: 20 }), run)
    expect(canDelegate(run)).toBe(false)
  })
  it('rejects excessive fan-out before any persistence', async () => {
    const parent = chat(agent())
    agent({ name: 'Sample helper' })
    const flush = vi.spyOn(parent, 'flush')
    await expect(
      createDelegateTool().execute(
        'sample',
        {
          agent: 'Sample helper',
          task: 'test',
          items: Array(MAX_DELEGATE_ITEMS + 1).fill('sample'),
        },
        undefined,
        { scope: parent.scopeResolver, session: parent, interactive: true }
      )
    ).rejects.toThrow(/at most/)
    expect(flush).not.toHaveBeenCalled()
  })
  it('shares a total budget across sibling and nested calls and reserves it before awaits', async () => {
    const parent = chat(agent())
    const target = agent({ name: 'Sample helper' })
    parent.root.delegatedRuns = MAX_RUNS_PER_CHAT - 1
    const start = vi
      .spyOn(DelegateRun.prototype, 'run')
      .mockResolvedValue({ runId: 'sample', branches: [] })
    const run = child(target, parent)
    const call = (session: ChatSession) =>
      createDelegateTool().execute('sample', { agent: target.name, task: 'test' }, undefined, {
        scope: session.scopeResolver,
        session,
        interactive: session.kind !== 'run',
      })
    const results = await Promise.allSettled([call(parent), call(run)])
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(start).toHaveBeenCalledOnce()
    expect(parent.root.delegatedRuns).toBe(MAX_RUNS_PER_CHAT)
    vi.restoreAllMocks()
  })
})
