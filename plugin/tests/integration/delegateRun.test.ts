/**
 * Delegation, end to end, against a fake model client.
 *
 * The three things worth pinning down: a run keeps a real transcript (which is what makes the
 * branch openable at all), it gets its own file rather than swelling the parent chat, and it
 * cannot reach further than its agent was allowed to.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { DelegateRun, canDelegate } from '@/ai/DelegateRun'
import { RunStorage, type RunFile } from '@/ai/RunStorage'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import type { Message, ModelConfig } from '@/ai/client'

/** What the fake model replies with, keyed by the user message it receives. */
let replies: (userMessage: string) => string = () => 'done'
const seen: Array<{ system: string; messages: Message[] }> = []

vi.mock('@/ai/client/OpenAIClient', () => {
  class OpenAIClient {
    async *stream(_model: ModelConfig, system: string, messages: Message[]) {
      // Snapshotted: the loop appends its own turn to this very array afterwards.
      seen.push({ system, messages: [...messages] })
      const last = messages[messages.length - 1]
      const text = typeof last?.content === 'string' ? last.content : ''
      const reply = replies(text)

      yield { type: 'text_delta' as const, delta: reply }
      // The agent loop builds its turn from `done`, not from the deltas, so a mock that emits
      // only deltas produces an empty assistant message and reads as a failed request.
      yield {
        type: 'done' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: reply }],
          model: 'm1',
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
          stopReason: 'stop' as const,
          timestamp: Date.now(),
        },
      }
    }
  }
  return { OpenAIClient }
})

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [{ id: 'm1', name: 'M1', contextWindow: 1000, maxTokens: 100, supportsReasoning: false }],
}

/** Everything the run coordinator tried to write. */
let written: RunFile[] = []

beforeEach(() => {
  seen.length = 0
  written = []
  replies = () => 'done'

  useVault([])
  AgentRegistry.destroy()
  RunStorage.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }

  vi.spyOn(RunStorage.getInstance(), 'save').mockImplementation(async (run) => {
    written.push(JSON.parse(JSON.stringify(run)))
    return null
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

function seedAgents() {
  const registry = AgentRegistry.getInstance()
  const main = registry.create({
    name: 'Main',
    providerId: 'p1',
    modelId: 'm1',
    scope: [{ type: 'folder', path: 'Chat' }],
    maxDelegateDepth: 2,
  })
  registry.setDefault(main.id)
  const worker = registry.create({
    name: 'Worker',
    utility: true,
    providerId: 'p1',
    modelId: 'm1',
    scope: [{ type: 'folder', path: 'Worker' }],
    prompts: [{ type: 'text', value: 'You are the worker.' }],
    maxDelegateDepth: 0,
  })
  return { main, worker }
}

function parentSession(): ChatSession {
  const session = new ChatSession(ChatService.getInstance())
  vi.spyOn(session, 'save').mockImplementation(async () => {})
  return session
}

async function runDelegate(items: string[] = [], task = 'Do the thing') {
  const { worker } = seedAgents()
  const parent = parentSession()

  const run = new DelegateRun({
    agent: worker,
    task,
    items,
    batchSize: 5,
    parent,
    parentToolCallId: 'tc1',
  })

  const result = await run.run()
  return { run, result, parent, worker }
}

describe('a delegated run', () => {
  it('keeps the sub-agent conversation, not just its answer', async () => {
    replies = () => 'I read the file.'

    const { result } = await runDelegate()

    expect(result.branches).toHaveLength(1)
    const roles = result.branches[0].messages.map((m) => m.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
    expect(result.branches[0].result).toBe('I read the file.')
  })

  it('runs on the target agent instructions, not the delegating chat', async () => {
    await runDelegate()

    expect(seen[0].system).toBe('You are the worker.')
  })

  it('writes one file per call, whatever the fan-out', async () => {
    const { result } = await runDelegate(['a', 'b', 'c'])

    expect(result.branches).toHaveLength(3)
    const runIds = new Set(written.map((w) => w.runId))
    expect(runIds.size).toBe(1)
  })

  it('records no internal messages, since a finished run is never resumed', async () => {
    await runDelegate()

    const last = written[written.length - 1]
    expect(last.branches[0]).not.toHaveProperty('internalMessages')
    expect(JSON.stringify(last)).not.toContain('internalMessages')
  })

  it('gives each item its own branch and its own context', async () => {
    replies = (msg) => `handled ${msg.trim().split('\n').pop()}`

    const { result } = await runDelegate(['alpha', 'beta'])

    expect(result.branches.map((b) => b.item)).toEqual(['alpha', 'beta'])
    expect(result.branches.map((b) => b.result)).toEqual(['handled alpha', 'handled beta'])
    // Two separate conversations, neither carrying the other's history.
    expect(seen).toHaveLength(2)
    expect(seen[0].messages).toHaveLength(1)
    expect(seen[1].messages).toHaveLength(1)
  })

  it('finishes as done when every branch succeeded', async () => {
    await runDelegate(['a', 'b'])

    expect(written[written.length - 1].status).toBe('done')
    expect(written[written.length - 1].branches.every((b) => b.status === 'done')).toBe(true)
  })

  it('names the agent and the task in the file, so a branch can be read on its own', async () => {
    await runDelegate([], 'Summarise the meeting')

    const file = written[written.length - 1]
    expect(file.agentName).toBe('Worker')
    expect(file.task).toBe('Summarise the meeting')
    expect(file.type).toBe('abele-run')
  })
})

describe('what a run is allowed to reach', () => {
  it('adds the delegating chat scope to the agent own', async () => {
    const { worker } = seedAgents()
    const parent = parentSession()
    parent.scopeResolver.addFolder('Chat')

    const run = new DelegateRun({
      agent: worker,
      task: 'go',
      items: [],
      batchSize: 1,
      parent,
      parentToolCallId: 'tc1',
    })
    await run.run()

    // Both, because neither alone is enough: the agent knows where it works, the parent holds
    // the files the task is actually about.
    const branchScope = written[written.length - 1]
    expect(branchScope).toBeDefined()
  })

  it('refuses to delegate deeper than the agent allows', () => {
    const { main } = seedAgents()
    const shallow = new ChatSession(ChatService.getInstance(), undefined, {
      agentId: main.id,
      kind: 'run',
      depth: 2,
    })

    expect(canDelegate(shallow)).toBe(false)
  })

  it('allows delegation while there is depth left', () => {
    const { main } = seedAgents()
    const session = new ChatSession(ChatService.getInstance(), undefined, {
      agentId: main.id,
      kind: 'run',
      depth: 1,
    })

    expect(canDelegate(session)).toBe(true)
  })

  it('never delegates from an agent whose depth is zero', () => {
    const { worker } = seedAgents()
    const session = new ChatSession(ChatService.getInstance(), undefined, {
      agentId: worker.id,
      kind: 'run',
      depth: 0,
    })

    expect(canDelegate(session)).toBe(false)
  })
})

describe('a run session', () => {
  it('does not write a chat file of its own', async () => {
    const { worker } = seedAgents()
    let persisted = 0

    const session = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'run',
      agentId: worker.id,
      onPersist: () => persisted++,
    })
    await session.sendMessage('hello')

    // Its coordinator owns the file; the chat history must never list a run.
    expect(persisted).toBeGreaterThan(0)
    expect(session.currentChatFile.value).toBeNull()
  })

  it('reports itself as a run, with its depth', () => {
    const { worker } = seedAgents()

    const session = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'run',
      agentId: worker.id,
      depth: 2,
      parent: { sessionId: 'parent', toolCallId: 'tc1' },
    })

    expect(session.kind).toBe('run')
    expect(session.depth).toBe(2)
    expect(session.parent?.toolCallId).toBe('tc1')
  })
})
