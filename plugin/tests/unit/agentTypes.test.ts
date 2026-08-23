import { describe, it, expect } from 'vitest'
import { createAgent } from '@/ai/agents/types'

describe('createAgent', () => {
  it('gives every field a value so no consumer has to guard for undefined', () => {
    const agent = createAgent()

    expect(agent.id).toMatch(/\S/)
    expect(agent.name).toBe('New agent')
    expect(agent.description).toBe('')
    expect(agent.utility).toBe(false)
    expect(agent.providerId).toBe('')
    expect(agent.modelId).toBe('')
    expect(agent.fallbackProviderId).toBeUndefined()
    expect(agent.prompts).toEqual([])
    expect(agent.permissionMode).toBe('confirm-all')
    expect(agent.toolModes).toEqual({})
    expect(agent.scope).toEqual([])
    expect(agent.fullVaultAccess).toBe(false)
    expect(agent.skillsMode).toBe('all')
    expect(agent.skills).toEqual([])
    expect(agent.maxDelegateDepth).toBe(2)
  })

  it('gives each agent its own id and its own mutable collections', () => {
    const first = createAgent()
    const second = createAgent()

    expect(first.id).not.toBe(second.id)

    first.prompts.push({ type: 'text', value: 'x' })
    expect(second.prompts).toEqual([])
  })

  it('applies overrides over the defaults', () => {
    const agent = createAgent({ name: 'Researcher', utility: true, maxDelegateDepth: 0 })

    expect(agent.name).toBe('Researcher')
    expect(agent.utility).toBe(true)
    expect(agent.maxDelegateDepth).toBe(0)
    // Untouched fields still get their defaults.
    expect(agent.permissionMode).toBe('confirm-all')
  })

  it('still mints a fresh id when one is passed explicitly as undefined', () => {
    // This is how duplication asks for a copy: spread the source, clear the id. A plain spread
    // would write `undefined` over the generated value and produce an agent nothing can find.
    const agent = createAgent({ id: undefined, name: 'Copy' })

    expect(agent.id).toMatch(/\S/)
    expect(agent.name).toBe('Copy')
  })
})
