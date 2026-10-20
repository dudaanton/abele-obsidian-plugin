import { describe, expect, it } from 'vitest'
import { parseLaunchArguments } from '@/debugger/launchArguments'

describe('program arguments without a shell', () => {
  it('keeps quoted spaces, empty values and literal shell syntax', () => {
    expect(parseLaunchArguments('order --label "sample item" \'\' "$(sample)"')).toEqual([
      'order',
      '--label',
      'sample item',
      '',
      '$(sample)',
    ])
  })
  it('accepts escaped spaces and quotes', () => {
    expect(parseLaunchArguments(String.raw`sample\ item "a\"b"`)).toEqual(['sample item', 'a"b'])
  })
  it('rejects unfinished quotes and escapes', () => {
    expect(() => parseLaunchArguments('"sample')).toThrow()
    expect(() => parseLaunchArguments('sample\\')).toThrow()
  })
})
