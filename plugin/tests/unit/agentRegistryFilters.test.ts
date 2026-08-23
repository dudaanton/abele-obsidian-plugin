import { describe, it, expect, beforeEach } from 'vitest'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { createAgent } from '@/ai/agents/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { SkillInfo } from '@/ai/tools/SkillTool'

const TOOLS = [
  { name: 'read' }, // core
  { name: 'edit' }, // core
  { name: 'web_search' }, // feature
  { name: 'fetch' }, // feature
  { name: 'delegate' }, // feature
]

const SKILLS: SkillInfo[] = [
  { path: 'Skills/Review.md', name: 'review', description: 'Review code' },
  { path: 'Skills/Plan.md', name: 'plan', description: 'Make a plan' },
]

beforeEach(() => {
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
})

describe('AgentRegistry.filterTools', () => {
  it('always keeps core tools, whatever toolModes says', () => {
    const agent = createAgent({ toolModes: { read: 'off', edit: 'off' } })

    const names = AgentRegistry.getInstance()
      .filterTools(agent, TOOLS)
      .map((t) => t.name)

    expect(names).toContain('read')
    expect(names).toContain('edit')
  })

  it('drops feature tools that are off or unmentioned', () => {
    const agent = createAgent({ toolModes: { web_search: 'auto' } })

    const names = AgentRegistry.getInstance()
      .filterTools(agent, TOOLS)
      .map((t) => t.name)

    expect(names).toEqual(['read', 'edit', 'web_search'])
  })

  it('keeps a feature tool set to ask, since asking is still availability', () => {
    const agent = createAgent({ toolModes: { fetch: 'ask' } })

    const names = AgentRegistry.getInstance()
      .filterTools(agent, TOOLS)
      .map((t) => t.name)

    expect(names).toContain('fetch')
  })

  it('drops delegate when the agent may not delegate, regardless of its tool mode', () => {
    const agent = createAgent({ toolModes: { delegate: 'auto' }, maxDelegateDepth: 0 })

    const names = AgentRegistry.getInstance()
      .filterTools(agent, TOOLS)
      .map((t) => t.name)

    expect(names).not.toContain('delegate')
  })
})

describe('AgentRegistry.visibleSkills', () => {
  it('shows everything in all mode', () => {
    const agent = createAgent({ skillsMode: 'all' })

    expect(AgentRegistry.getInstance().visibleSkills(agent, SKILLS)).toHaveLength(2)
  })

  it('shows nothing in none mode, even when skills are listed', () => {
    const agent = createAgent({ skillsMode: 'none', skills: ['review'] })

    expect(AgentRegistry.getInstance().visibleSkills(agent, SKILLS)).toEqual([])
  })

  it('shows only the named skills in selected mode', () => {
    const agent = createAgent({ skillsMode: 'selected', skills: ['review'] })

    const visible = AgentRegistry.getInstance().visibleSkills(agent, SKILLS)

    expect(visible.map((s) => s.name)).toEqual(['review'])
  })

  it('ignores a selected skill that no longer exists in the vault', () => {
    const agent = createAgent({ skillsMode: 'selected', skills: ['review', 'deleted'] })

    const visible = AgentRegistry.getInstance().visibleSkills(agent, SKILLS)

    expect(visible.map((s) => s.name)).toEqual(['review'])
  })
})
