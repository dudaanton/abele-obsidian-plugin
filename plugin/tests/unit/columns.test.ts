import { describe, expect, it } from 'vitest'
import { parseColumnsHeader, columnWeights } from '@/columns/core'

describe('column callout record', () => {
  it('reads the proposed parent and preserves the title separately', () => {
    expect(parseColumnsHeader('> [!abele-columns|ratio=2:1 mobile=stack] Sample')).toEqual({
      ratio: [2, 1],
      mobile: 'stack',
    })
  })

  it('accepts equal columns and whitespace between quote markers', () => {
    expect(parseColumnsHeader('  > > [!abele-columns]')).toEqual({ ratio: null, mobile: 'stack' })
    expect(columnWeights(null, 3)).toEqual([1, 1, 1])
    expect(columnWeights([2, 1], 2)).toEqual([2, 1])
  })

  it('accepts positive fractional ratios without evaluating markup', () => {
    expect(parseColumnsHeader('> [!abele-columns|mobile=stack ratio=1.5:1:2]')).toEqual({
      ratio: [1.5, 1, 2],
      mobile: 'stack',
    })
  })

  it.each([
    '> [!abele-column]',
    '> [!other|ratio=2:1]',
    'text [!abele-columns]',
    '> [!abele-columns|ratio=0:1]',
    '> [!abele-columns|ratio=-2:1]',
    '> [!abele-columns|ratio=Infinity:1]',
    '> [!abele-columns|ratio=1:]',
    '> [!abele-columns|ratio=2]',
    '> [!abele-columns|ratio=2:1 ratio=1:2]',
    '> [!abele-columns|mobile=shrink]',
    '> [!abele-columns|unknown=value]',
    '> [!abele-columns]-',
  ])('leaves unsupported or malformed records alone: %s', (line) => {
    expect(parseColumnsHeader(line)).toBeNull()
  })

  it('does not silently apply a ratio to the wrong number of children', () => {
    expect(columnWeights([2, 1], 3)).toBeNull()
    expect(columnWeights(null, 1)).toBeNull()
  })
})
