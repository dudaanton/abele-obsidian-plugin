import { describe, expect, it } from 'vitest'
import { replaceCheckboxLine } from '@/checkboxes/register'

describe('reading-view checkbox writes', () => {
  it('changes one marker, keeping CRLF and all neighbouring text', () => {
    const text = 'Sample\r\n\r\n- [/] One\r\n  - [?] Two\r\n'
    expect(replaceCheckboxLine(text, 3, '  - [?] Two\r', '<')).toBe(
      'Sample\r\n\r\n- [/] One\r\n  - [<] Two\r\n'
    )
  })
  it('accepts an empty CRLF checklist item', () => {
    expect(replaceCheckboxLine('- [ ]\r\n', 0, '- [ ]\r', '/')).toBe('- [/]\r\n')
  })
  it('refuses a menu whose source line moved or changed', () => {
    expect(() =>
      replaceCheckboxLine('New paragraph\n- [/] Sample\n', 0, '- [/] Sample', 'x')
    ).toThrow('checklist changed')
    expect(() => replaceCheckboxLine('- [?] Sample\n', 0, '- [/] Sample', 'x')).toThrow(
      'checklist changed'
    )
  })
})
