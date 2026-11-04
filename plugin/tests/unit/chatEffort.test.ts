import { describe, expect, it } from 'vitest'
import { resolveChatEffort } from '@/ai/chatEffort'

describe('per-chat effort', () => {
  it('follows the model unless the chat chose a level', () => {
    expect(
      resolveChatEffort({ supportsReasoning: true, reasoningEffort: 'medium' }, undefined)
    ).toBe('medium')
    expect(resolveChatEffort({ supportsReasoning: true, reasoningEffort: 'medium' }, 'high')).toBe(
      'high'
    )
    expect(resolveChatEffort({ supportsReasoning: true }, undefined)).toBeUndefined()
  })
  it('does not send a retained override to a model without reasoning', () => {
    expect(resolveChatEffort({ supportsReasoning: false }, 'high')).toBeUndefined()
    expect(resolveChatEffort({ supportsReasoning: true }, 'high')).toBe('high')
  })
})
