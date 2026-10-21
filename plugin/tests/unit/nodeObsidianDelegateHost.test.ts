import { afterEach, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type { NodeClient } from '@abele/node-client'
import { validateParams } from '@abele/node-protocol'
import { useVault } from '../helpers/testEnv'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeObsidianDelegate, nodeConversation } from '@/node/NodeObsidianDelegate'
import type { ObsidianInvocation } from '@/node/NodeObsidianExecutor'
import type { ChatSession } from '@/ai/ChatSession'

afterEach(() => vi.restoreAllMocks())
function fixture(lostClaim = false, gate?: Promise<void>) {
  useVault([{ path: 'sample.md', content: 'Sample' }])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = structuredClone(DEFAULT_AI_SETTINGS)
  const registry = AgentRegistry.getInstance()
  const parent = registry.create({
    name: 'Sample parent',
    fullVaultAccess: true,
    maxDelegateDepth: 2,
  })
  const target = registry.create({
    name: 'Sample target',
    fullVaultAccess: true,
    maxDelegateDepth: 2,
  })
  const snapshot = {
    vault_id: 'sample-vault',
    agent_id: target.id,
    revision: 'sample-target-revision',
    tools: [
      { name: 'read', mode: 'auto' as const, description: 'Read', inputSchema: {} },
      { name: 'create', mode: 'off' as const, description: 'Create', inputSchema: {} },
    ],
    max_delegate_depth: 2,
    conversation: nodeConversation(target),
  }
  const branch = {
    branch_id: 'sample-branch',
    state: lostClaim ? 'running' : 'queued',
    item: 'Sample task',
  }
  const run = {
    call_id: 'sample-call',
    run_id: 'sample-host-run',
    root_id: 'sample-session',
    depth: 1,
    depth_limit: 2,
    batch_size: 1,
    configuration: snapshot,
    parent_context: {
      ...nodeConversation(parent),
      scope: [{ type: 'file', path: 'sample.md' }],
      fullVaultAccess: false,
    },
    branches: [branch],
    status: 'running',
  }
  let begun = lostClaim
  const history: unknown[] = []
  const request = vi.fn(async (method: string, raw: Record<string, unknown>) => {
    validateParams(method, raw)
    const action = method.split('.').at(-1)
    if (action === 'configuration')
      return { configuration: { conversation: nodeConversation(parent) } }
    if (action === 'get')
      return raw.run_id
        ? run
        : { runs: begun ? [{ run_id: run.run_id, call_id: run.call_id }] : [] }
    if (action === 'begin') {
      begun = true
      return run
    }
    if (action === 'claim') {
      const execute = branch.state === 'queued'
      branch.state = 'running'
      return { execute, branch: { ...branch, task: 'Sample task' } }
    }
    if (action === 'record') {
      history.push(...(raw.messages as unknown[]))
      if (raw.state !== 'running') {
        branch.state = String(raw.state)
        run.status = 'done'
      }
      return { branch_id: branch.branch_id, state: branch.state, last_seq: history.length }
    }
    if (action === 'branch') return { ...branch, result: 'Sample result' }
    if (action === 'history')
      return raw.after_seq === 0
        ? { entries: [{ seq: 1, message: { text: 'Earlier' } }], next_seq: 1, has_more: true }
        : { entries: [{ seq: 2, message: { text: 'Later' } }], next_seq: 2, has_more: false }
    throw new Error('Unexpected method: ' + method)
  })
  const starts = vi.fn()
  const sessions: ChatSession[] = []
  const makeSession = (id: string, options: ConstructorParameters<typeof ChatSession>[2]) => {
    const agent = registry.get(options!.agentId!)!
    const scope = new ScopeResolver()
    const session = {
      id,
      agent: { value: agent },
      scopeResolver: scope,
      depth: options!.depth,
      depthLimit: 3,
      permissionMode: { value: agent.permissionMode },
      toolModes: { value: agent.toolModes },
      allMessages: { value: [] as unknown[] },
      error: { value: '' },
      offeredSkillNames: () => new Set<string>(),
      openToolSections: () => [],
      inheritToolSections: () => {},
      githubAgent: () => agent,
      applyRunScope: (entries: never[], full: boolean, ceiling: ScopeResolver) => {
        scope.entries.value = entries
        scope.setFullVaultAccess(full)
        scope.setCeiling(ceiling)
      },
      sendMessage: async (task: string) => {
        starts(task)
        if (gate) await gate
        expect(scope.isInScope('sample.md')).toBe(true)
        expect(scope.isInScope('outside.md')).toBe(false)
        expect(options!.toolCeiling!({ name: 'create' } as never)).toBe(false)
        session.allMessages.value = [
          { id: 'sample-answer', role: 'assistant', content: 'Sample result', timestamp: 1 },
        ]
        options!.onPersist!()
      },
      abort: vi.fn(),
      lastAssistantText: () => 'Sample result',
      destroy: () => scope.destroy(),
    } as unknown as ChatSession
    sessions.push(session)
    return session
  }
  const store = new NodeClientStore('sample-delegate-host', new IDBFactory())
  const host = new NodeObsidianDelegate(
    { request } as unknown as NodeClient,
    store,
    'sample-client',
    async () => snapshot,
    makeSession
  )
  const invocation: ObsidianInvocation = {
    invocation_id: 'sample-invocation',
    session_id: 'sample-session',
    agent_id: parent.id,
    vault_id: 'sample-vault',
    revision: 'sample-revision',
    run_id: 'sample-run',
    call_id: 'sample-call',
    installation_id: 'sample-installation',
    tool_name: 'delegate',
    arguments: { agent: target.name, task: 'Sample task' },
    created_at: 1,
    executor: null,
    action: 'hosted',
    state: 'executing',
  }
  return { host, store, request, starts, history, invocation, branch, sessions, run }
}
it('claims once, runs a private ordinary branch under its parent ceiling and records history before settling', async () => {
  const f = fixture()
  try {
    await f.host.handle(f.invocation, new AbortController().signal)
    await f.host.handle(f.invocation, new AbortController().signal)
    expect(f.starts).toHaveBeenCalledExactlyOnceWith('Sample task')
    expect(f.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'sample-answer',
          text: expect.stringContaining('Sample result'),
        }),
      ])
    )
    expect(f.branch.state).toBe('done')
    expect(f.request.mock.calls.some(([m]) => m.endsWith('.complete'))).toBe(false)
  } finally {
    f.store.close()
  }
})
it('reads every retained history page and records unknown after a lost physical claim without another start', async () => {
  const f = fixture(true)
  try {
    await f.host.handle(f.invocation, new AbortController().signal)
    expect(f.starts).not.toHaveBeenCalled()
    expect(f.branch.state).toBe('outcome_unknown')
    expect(f.request.mock.calls.filter(([m]) => m.endsWith('.history'))).toHaveLength(2)
  } finally {
    f.store.close()
  }
})
it('keeps sibling sub-runs owned until they settle when another branch loses its claim reply', async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const f = fixture(false, gate)
  f.run.batch_size = 2
  f.run.branches.push({ branch_id: 'sample-second-branch', state: 'queued', item: 'Second task' })
  const original = f.request.getMockImplementation()!
  f.request.mockImplementation(async (method, params) => {
    if (method.endsWith('.claim') && params.branch_id === 'sample-branch') {
      await new Promise((resolve) => setTimeout(resolve, 10))
      throw new Error('Sample lost claim reply')
    }
    return original(method, params)
  })
  let settled = false
  const task = f.host
    .handle(f.invocation, new AbortController().signal)
    .catch(() => {})
    .finally(() => {
      settled = true
    })
  try {
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(f.starts).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
  } finally {
    release()
    await task
    f.store.close()
  }
})
it('retains a known final result when a history append reply is lost and replays receipts without restarting', async () => {
  const f = fixture()
  const original = f.request.getMockImplementation()!
  let lost = true
  let admitted = false
  f.request.mockImplementation(async (method, params) => {
    if (method.endsWith('.begin')) {
      if (admitted) throw new Error('A new settings revision prevents re-admission')
      admitted = true
    }
    if (lost && method.endsWith('.record') && params.state === 'running') {
      lost = false
      throw new Error('Sample lost history reply')
    }
    return original(method, params)
  })
  try {
    await expect(f.host.handle(f.invocation, new AbortController().signal)).rejects.toThrow(
      'Sample lost history reply'
    )
    await f.host.handle(f.invocation, new AbortController().signal)
    expect(f.starts).toHaveBeenCalledOnce()
    expect(f.branch.state).toBe('done')
  } finally {
    f.store.close()
  }
})
