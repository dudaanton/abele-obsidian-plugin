/**
 * Live resolution rests entirely on this: a `computed` reading an agent must re-evaluate when
 * that agent is edited. `AbeleConfig` is a plain class, so without the registry handing out a
 * reactive array the computed would cache its first answer forever and "editing an agent
 * reaches every running chat" would quietly not be true.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { computed, isReactive } from 'vue'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

beforeEach(() => {
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
})

describe('AgentRegistry reactivity', () => {
  it('hands out agents that Vue can track', () => {
    const agent = AgentRegistry.getInstance().create({ name: 'Default' })

    expect(isReactive(AbeleConfig.getInstance().ai.agents)).toBe(true)
    expect(isReactive(agent)).toBe(true)
  })

  it('invalidates a computed when an agent field changes', () => {
    const registry = AgentRegistry.getInstance()
    const agent = registry.create({ name: 'Default', permissionMode: 'confirm-all' })

    const mode = computed(() => registry.get(agent.id)?.permissionMode)
    expect(mode.value).toBe('confirm-all')

    registry.update(agent.id, { permissionMode: 'allow-all' })

    expect(mode.value).toBe('allow-all')
  })

  it('invalidates a computed when an agent is added or removed', () => {
    const registry = AgentRegistry.getInstance()
    registry.create({ name: 'Default' })

    const names = computed(() => registry.list().map((a) => a.name))
    expect(names.value).toEqual(['Default'])

    const second = registry.create({ name: 'Janitor' })
    expect(names.value).toEqual(['Default', 'Janitor'])

    registry.remove(second.id)
    expect(names.value).toEqual(['Default'])
  })

  it('invalidates a computed when the whole settings object is replaced', () => {
    // A settings reload swaps `ai` out from under everything holding a reference to the old
    // array. The version counter is what makes that case invalidate too.
    const registry = AgentRegistry.getInstance()
    registry.create({ name: 'Default' })

    const names = computed(() => registry.list().map((a) => a.name))
    expect(names.value).toEqual(['Default'])

    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
    registry.notifyConfigReloaded()

    expect(names.value).toEqual([])
  })

  it('tracks the default agent changing', () => {
    const registry = AgentRegistry.getInstance()
    const first = registry.create({ name: 'Default' })
    const second = registry.create({ name: 'Other' })
    registry.setDefault(first.id)

    const name = computed(() => registry.defaultAgent()?.name)
    expect(name.value).toBe('Default')

    registry.setDefault(second.id)

    expect(name.value).toBe('Other')
  })
})
