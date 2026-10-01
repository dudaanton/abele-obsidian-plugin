import { beforeEach, describe, expect, it } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { AgentTool } from '@/ai/client'
import { useVault } from '../helpers/testEnv'
import { destroyChatsAfterEach } from '../helpers/chatTeardown'

destroyChatsAfterEach()
const skill = (path: string, name: string) => ({
  path,
  content: `Instructions for ${name}`,
  frontmatter: { type: 'abele-skill', name, description: `${name} procedure` },
})
let agentId: string
const session = () => {
  const chat = new ChatSession(ChatService.getInstance(), undefined, { agentId })
  chat.scopeResolver.addFolder('Project')
  return chat
}
const tool = (chat: ChatSession) =>
  (chat as unknown as { getTools(): AgentTool[] }).getTools().find((t) => t.name === 'skill')!

beforeEach(() => {
  useVault([
    skill('Skills/Common.md', 'Common'),
    skill('Project/Local.md', 'Local'),
    skill('Clips/Remote.md', 'Remote'),
    skill('Skills-extra/Other.md', 'Other'),
  ])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = {
    ...DEFAULT_AI_SETTINGS,
    skillsFolder: 'Skills',
    agents: [],
    defaultAgentId: '',
  }
  agentId = AgentRegistry.getInstance().create({ name: 'Sample worker' }).id
})

describe('skill provenance', () => {
  it('offers only folder and scope skills, with an exact folder boundary', () => {
    const description = tool(session()).description
    expect(description).toContain('Common procedure')
    expect(description).toContain('Local procedure')
    expect(description).not.toContain('Remote procedure')
    expect(description).not.toContain('Other procedure')
  })
  it('cannot load an out-of-scope namesake in place of the offered skill', async () => {
    useVault([skill('Clips/Impersonator.md', 'Common'), skill('Skills/Common.md', 'Common')])
    const app = (await import('@/stores/GlobalStore')).GlobalStore.getInstance().app
    const impostor = app.vault.getAbstractFileByPath('Clips/Impersonator.md')!
    await app.vault.modify(impostor as never, 'Unapproved foreign instructions')
    const result = await tool(session()).execute('sample', { name: 'Common' })
    expect(result.content[0].text).toBe('Instructions for Common')
    expect(result.content[0].text).not.toContain('Unapproved')
  })
  it('honours selected and disabled skills', () => {
    AgentRegistry.getInstance().update(agentId, { skillsMode: 'selected', skills: ['Local'] })
    expect(tool(session()).description).toContain('Local procedure')
    expect(tool(session()).description).not.toContain('Common procedure')
    AgentRegistry.getInstance().update(agentId, { skillsMode: 'none' })
    expect(tool(session()).description).not.toContain('Local procedure')
  })
  it('asks about a skill outside both places even under allow-all', () => {
    const chat = session()
    chat.permissionMode.value = 'allow-all'
    expect(chat.needsApproval('skill', { name: 'Common' })).toBe(false)
    expect(chat.needsApproval('skill', { name: 'Local' })).toBe(false)
    expect(chat.needsApproval('skill', { name: 'Remote' })).toBe(true)
  })
  it('refuses an unapproved foreign skill and accepts this call after approval', async () => {
    const chat = session()
    await expect(tool(chat).execute('a', { name: 'Remote' })).rejects.toThrow(/approval/)
    const result = await tool(chat).execute('b', { name: 'Remote' }, undefined, {
      scope: chat.scopeResolver,
      interactive: true,
      approved: true,
    })
    expect(result.content[0].text).toContain('Instructions for Remote')
    await expect(tool(chat).execute('c', { name: 'Remote' })).rejects.toThrow(/approval/)
  })
})
