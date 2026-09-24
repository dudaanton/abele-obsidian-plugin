import { describe, it, expect } from 'vitest'
import { estimateTokens } from '@/ai/tokens'

describe('the token estimate', () => {
  it('is nothing for nothing', () => {
    expect(estimateTokens('')).toBe(0)
  })

  it('prices English prose near four characters a token', () => {
    const prose =
      'The quick brown fox jumps over the lazy dog, and then it runs back into the forest ' +
      'where it lives with its family. Nobody knows why it does this every single morning.'
    const ratio = prose.length / estimateTokens(prose)
    expect(ratio).toBeGreaterThan(3.3)
    expect(ratio).toBeLessThan(5)
  })

  it('prices other scripts dearer per character than English', () => {
    const ru = 'Обсудили план на следующий квартал и зафиксировали риски.'
    const en = 'We discussed the plan for next quarter and wrote down the risks.'
    expect(ru.length / estimateTokens(ru)).toBeLessThan(en.length / estimateTokens(en))
  })

  it('grows with the text', () => {
    expect(estimateTokens('a b c d e f')).toBeLessThan(estimateTokens('a b c d e f g h i j'))
  })
})
