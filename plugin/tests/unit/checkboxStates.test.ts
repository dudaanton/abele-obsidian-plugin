import { describe, expect, it } from 'vitest'
import { CHECKBOX_STATES, checkboxState, nextCheckboxState } from '@/checkboxes/states'
import { checkboxOnLine, changeCheckbox } from '@/checkboxes/markdown'
import { previewText } from '@/helpers/markdownPreview'
import { plainText } from '@/scripting/noteInfo'
import { parseTaskLine } from '@/helpers/tasksUtils'

describe('inline checkbox states', () => {
  it('distinguishes completion from cancellation and unfinished states', () => {
    expect(CHECKBOX_STATES.map((s) => s.marker)).toEqual([' ', '/', 'x', '-', '>', '<', '?', '!'])
    expect(CHECKBOX_STATES.filter((s) => s.done).map((s) => s.marker)).toEqual(['x'])
    expect(CHECKBOX_STATES.filter((s) => !s.open).map((s) => s.marker)).toEqual(['x', '-'])
    expect(checkboxState('X')).toBe(checkboxState('x'))
    expect(checkboxState('z')).toBeUndefined()
  })

  it('cycles in menu order, including wraparound and uppercase completion', () => {
    expect(CHECKBOX_STATES.map((s) => nextCheckboxState(s.marker))).toEqual([
      '/',
      'x',
      '-',
      '>',
      '<',
      '?',
      '!',
      ' ',
    ])
    expect(nextCheckboxState('X')).toBe('-')
  })

  it.each(['- [/] Sample', '  * [/] Sample', '> 1. [/] Sample', '> > + [/] Sample', '2) [/]'])(
    'changes only the marker in %s',
    (line) => {
      expect(checkboxOnLine(line)?.state.marker).toBe('/')
      expect(changeCheckbox(line, '?')).toBe(line.replace('[/]', '[?]'))
    }
  )

  it.each(['Sample [/] text', '- [z] Sample', '- [?]not a checkbox', '- [[sample-note]]'])(
    'leaves other syntax alone: %s',
    (line) => {
      expect(checkboxOnLine(line)).toBeNull()
      expect(changeCheckbox(line, 'x')).toBe(line)
    }
  )

  it.each([' ', '/', 'x', 'X', '-', '>', '<', '?', '!'])(
    'strips state %s from prose previews',
    (marker) => {
      expect(previewText(`- [${marker}] Sample item`)).toBe('Sample item')
      expect(plainText(`- [${marker}] Sample item`)).toBe('Sample item')
    }
  )

  it('keeps the special task-note embed syntax separate', () => {
    expect(parseTaskLine('- [ ] [[sample-task]]')).toBe('[[sample-task]]')
    for (const marker of ['/', 'x', '-', '>', '<', '?', '!']) {
      expect(parseTaskLine(`- [${marker}] [[sample-task]]`)).toBeNull()
    }
  })
})
