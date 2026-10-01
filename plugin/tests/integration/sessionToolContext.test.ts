import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { ScopeResolver } from '@/ai/ScopeResolver'
import type { AgentTool } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

destroyChatsAfterEach()

const toolsOf = (session: ChatSession) =>
  (session as unknown as { getTools(): AgentTool[] }).getTools()
const toolOf = (session: ChatSession, name: string) =>
  toolsOf(session).find((t) => t.name === name)!
const text = (result: { content: { text: string }[] }) => result.content.map((c) => c.text).join('')

function scoped(folder: string) {
  const session = new ChatSession(ChatService.getInstance())
  session.scopeResolver.entries.value = [{ type: 'folder', path: folder }]
  return session
}

beforeEach(() => {
  useVault([
    { path: 'Project/Visible.md', content: 'visible' },
    { path: 'Separate/Hidden.md', content: 'hidden' },
  ])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
})

describe('concurrent tool calls', () => {
  it('each workspace sees only the calling chat', async () => {
    const project = scoped('Project')
    const separate = scoped('Separate')
    const results = await Promise.all([
      toolOf(project, 'workspace').execute('a', {}),
      toolOf(separate, 'workspace').execute('b', {}),
    ])
    expect(text(results[0])).toContain('Visible')
    expect(text(results[0])).not.toContain('Hidden')
    expect(text(results[1])).toContain('Hidden')
    expect(text(results[1])).not.toContain('Visible')
  })

  it('a paused call cannot borrow a second chat scope after awaiting', async () => {
    const project = scoped('Project')
    const separate = scoped('Separate')
    let release!: () => void
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const guard = (project as unknown as { readGuard: { check(): Promise<null> } }).readGuard
    vi.spyOn(guard, 'check').mockImplementation(async () => {
      await paused
      return null
    })
    const reading = toolOf(project, 'read').execute('a', { path: 'Separate/Hidden.md' })
    const result = await toolOf(separate, 'workspace').execute('b', {})
    expect(text(result)).toContain('Hidden')
    release()
    await expect(reading).rejects.toThrow(/scope/)
  })

  it('asks questions in the calling chat rather than the selected tab', async () => {
    const project = scoped('Project')
    const separate = scoped('Separate')
    project.toolModes.value = { questions: 'auto' }
    ChatService.getInstance().adoptSession(separate)
    const own = vi.spyOn(project, 'askQuestions').mockResolvedValue(['own answer'])
    const other = vi.spyOn(separate, 'askQuestions').mockResolvedValue(['other answer'])
    const result = await toolOf(project, 'questions').execute('sample', {
      questions: [{ question: 'Choose a label', options: ['one', 'two'] }],
    })
    expect(own).toHaveBeenCalledOnce()
    expect(other).not.toHaveBeenCalled()
    expect(text(result)).toContain('own answer')
    expect(text(result)).not.toContain('other answer')
  })
  it('does not borrow the selected chat for an unattended questionnaire', async () => {
    const selected = scoped('Separate')
    ChatService.getInstance().adoptSession(selected)
    const ask = vi.spyOn(selected, 'askQuestions').mockResolvedValue(['other answer'])
    const { createQuestionsTool } = await import('@/ai/tools/QuestionsTool')
    await expect(
      createQuestionsTool().execute(
        'sample',
        { questions: [{ question: 'Choose a label', options: ['one'] }] },
        undefined,
        { scope: new ScopeResolver(), interactive: false }
      )
    ).rejects.toThrow(/interactive/)
    expect(ask).not.toHaveBeenCalled()
  })
  it('keeps files created after an await in the calling scope', async () => {
    const project = scoped('Project')
    const separate = scoped('Separate')
    await Promise.all([
      toolOf(project, 'create').execute('a', { path: 'Project/New.md', content: 'new' }),
      toolOf(separate, 'workspace').execute('b', {}),
    ])
    expect(project.scopeResolver.entries.value).toContainEqual({
      type: 'file',
      path: 'Project/New.md',
    })
    expect(separate.scopeResolver.entries.value).not.toContainEqual({
      type: 'file',
      path: 'Project/New.md',
    })
    expect(ScopeResolver.getInstance().entries.value).not.toContainEqual({
      type: 'file',
      path: 'Project/New.md',
    })
  })
})
