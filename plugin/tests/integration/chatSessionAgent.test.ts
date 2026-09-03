/**
 * A chat resolves its settings from its agent on every read, and records a deliberate change
 * as an override.
 *
 * The distinction under test is the whole point of the phase: before this, a session copied
 * the global defaults at construction, so editing settings had no effect on a chat already
 * open. Now the only values a session owns are the ones somebody deliberately changed in it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type AiProvider } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const provider: AiProvider = {
  id: 'p1',
  name: 'Provider',
  baseUrl: 'http://localhost/v1',
  apiKeyId: 'k',
  models: [
    { id: 'big', name: 'Big', contextWindow: 100, maxTokens: 10, supportsReasoning: false },
    { id: 'small', name: 'Small', contextWindow: 50, maxTokens: 5, supportsReasoning: false },
  ],
}

function newSession(): ChatSession {
  return new ChatSession(ChatService.getInstance())
}

function seedAgent(overrides = {}) {
  const registry = AgentRegistry.getInstance()
  const agent = registry.create({
    name: 'Default',
    providerId: 'p1',
    modelId: 'big',
    permissionMode: 'allow-edit',
    toolModes: { web_search: 'auto' },
    scope: [{ type: 'folder', path: 'Notes' }],
    ...overrides,
  })
  registry.setDefault(agent.id)
  return agent
}

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    providers: [provider],
    agents: [],
    defaultAgentId: '',
  }
})

describe('a new chat session', () => {
  it('starts on the default agent', () => {
    const agent = seedAgent()

    const session = newSession()

    expect(session.agentId.value).toBe(agent.id)
    expect(session.agent.value?.name).toBe('Default')
  })

  it('reports the agent model and permissions without copying them', () => {
    seedAgent()

    const session = newSession()

    expect(session.activeProviderId.value).toBe('p1')
    expect(session.activeModelId.value).toBe('big')
    expect(session.permissionMode.value).toBe('allow-edit')
    expect(session.toolModes.value).toEqual({ web_search: 'auto' })
    expect(session.overrides.value).toEqual({})
  })

  it('mirrors the agent scope', () => {
    seedAgent()

    const session = newSession()

    expect(session.scopeResolver.entries.value).toEqual([{ type: 'folder', path: 'Notes' }])
  })
})

describe('editing the agent while a chat is open', () => {
  it('changes what the chat reports, with nothing reloaded', () => {
    const agent = seedAgent()
    const session = newSession()
    expect(session.permissionMode.value).toBe('allow-edit')

    AgentRegistry.getInstance().update(agent.id, { permissionMode: 'allow-all', modelId: 'small' })

    expect(session.permissionMode.value).toBe('allow-all')
    expect(session.activeModelId.value).toBe('small')
  })

  it('changes the chat scope too', () => {
    const agent = seedAgent()
    const session = newSession()

    AgentRegistry.getInstance().update(agent.id, {
      scope: [{ type: 'folder', path: 'Projects' }],
    })

    expect(session.scopeResolver.entries.value).toEqual([{ type: 'folder', path: 'Projects' }])
  })
})

describe('overriding a setting in one chat', () => {
  it('records an override and stops tracking the agent for that field', () => {
    const agent = seedAgent()
    const session = newSession()

    session.permissionMode.value = 'confirm-all'

    expect(session.overrides.value.permissionMode).toBe('confirm-all')

    AgentRegistry.getInstance().update(agent.id, { permissionMode: 'allow-all' })

    // The override wins: somebody deliberately narrowed this chat.
    expect(session.permissionMode.value).toBe('confirm-all')
  })

  it('leaves every other field still tracking the agent', () => {
    const agent = seedAgent()
    const session = newSession()

    session.permissionMode.value = 'confirm-all'
    AgentRegistry.getInstance().update(agent.id, { modelId: 'small' })

    expect(session.activeModelId.value).toBe('small')
  })

  it('resumes tracking when the override is cleared', () => {
    const agent = seedAgent()
    const session = newSession()
    session.permissionMode.value = 'confirm-all'

    session.clearOverride('permissionMode')

    expect(session.permissionMode.value).toBe('allow-edit')
    AgentRegistry.getInstance().update(agent.id, { permissionMode: 'allow-all' })
    expect(session.permissionMode.value).toBe('allow-all')
  })

  it('reports which fields are overridden, so the UI can offer a reset', () => {
    seedAgent()
    const session = newSession()

    expect(session.isOverridden('permissionMode')).toBe(false)

    session.permissionMode.value = 'confirm-all'

    expect(session.isOverridden('permissionMode')).toBe(true)
  })

  it('stops mirroring the agent scope once the scope is edited here', () => {
    const agent = seedAgent()
    const session = newSession()

    session.scopeResolver.addFolder('Inbox')

    expect(session.isOverridden('scope')).toBe(true)

    AgentRegistry.getInstance().update(agent.id, { scope: [{ type: 'folder', path: 'Elsewhere' }] })

    const paths = session.scopeResolver.entries.value.map((e) => e.path)
    expect(paths).toContain('Inbox')
    expect(paths).not.toContain('Elsewhere')
  })

  it('restores the agent scope on reset', () => {
    seedAgent()
    const session = newSession()
    session.scopeResolver.addFolder('Inbox')

    session.clearOverride('scope')

    expect(session.scopeResolver.entries.value).toEqual([{ type: 'folder', path: 'Notes' }])
    expect(session.isOverridden('scope')).toBe(false)
  })
})

describe('switching agent mid-chat', () => {
  it('drops the overrides, which were expressed against the previous agent', () => {
    seedAgent()
    const other = AgentRegistry.getInstance().create({
      name: 'Other',
      providerId: 'p1',
      modelId: 'small',
      permissionMode: 'confirm-all',
    })
    const session = newSession()
    session.permissionMode.value = 'allow-all'

    session.switchAgent(other.id)

    expect(session.agentId.value).toBe(other.id)
    expect(session.overrides.value).toEqual({})
    expect(session.permissionMode.value).toBe('confirm-all')
  })
})

describe('a chat whose agent is gone', () => {
  it('falls back to the default agent rather than throwing', () => {
    const agent = seedAgent()
    const fallback = AgentRegistry.getInstance().create({
      name: 'Fallback',
      providerId: 'p1',
      modelId: 'small',
    })
    AgentRegistry.getInstance().setDefault(fallback.id)
    const session = newSession()
    session.switchAgent(agent.id)

    AgentRegistry.getInstance().remove(agent.id)

    expect(session.agent.value?.id).toBe(fallback.id)
    expect(session.activeModelId.value).toBe('small')
  })
})

describe('a comment session', () => {
  it('puts the anchored note in scope on top of the agent scope', () => {
    seedAgent({ scope: [{ type: 'folder', path: 'Notes' }] })

    const session = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'comment',
      anchor: { note: 'Journal/2026-09-02.md', quote: 'a passage' },
    })

    expect(session.scopeResolver.entries.value).toEqual([
      { type: 'folder', path: 'Notes' },
      { type: 'file', path: 'Journal/2026-09-02.md' },
    ])
    expect(session.scopeResolver.isInScope('Journal/2026-09-02.md')).toBe(true)
  })

  /** The note is the session's own context, not something anyone chose in this chat. */
  it('does not record the note as a scope override', () => {
    seedAgent()

    const session = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'comment',
      anchor: { note: 'Journal/2026-09-02.md' },
    })

    expect(session.isOverridden('scope')).toBe(false)
  })

  it('keeps the note in scope after the agent is switched', () => {
    seedAgent()
    const other = AgentRegistry.getInstance().create({ name: 'Other', scope: [] })
    const session = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'comment',
      anchor: { note: 'Journal/2026-09-02.md' },
    })

    session.switchAgent(other.id)

    expect(session.scopeResolver.isInScope('Journal/2026-09-02.md')).toBe(true)
  })
})
