/**
 * Taking a footnote out of a note.
 *
 * Removal has two halves: dropping every `[^label]` reference from the prose, and dropping the
 * `[^label]: …` definition together with the indented lines that continue it. The second half
 * is the subtle one — a definition can run over several lines, and across blank lines, so
 * deleting only the line that starts it would leave its body behind as stray text.
 *
 * These drive the text transformation directly. The command around it asks the user first and
 * then writes the result into the editor; what is worth pinning down is the transformation.
 */
import { describe, it, expect } from 'vitest'
import { withoutFootnote } from '@/commands/footnoteCommands'

describe('removing a footnote from a note', () => {
  it('drops the reference and leaves the sentence', () => {
    expect(withoutFootnote('A claim[^1] and more.\n\n[^1]: The source.\n', '1')).toBe(
      'A claim and more.\n\n'
    )
  })

  it('drops every reference to the same footnote', () => {
    expect(withoutFootnote('One[^1] two[^1] three[^1].\n\n[^1]: Source.\n', '1')).toBe(
      'One two three.\n\n'
    )
  })

  it('leaves other footnotes untouched', () => {
    const before = 'A[^1] and B[^2].\n\n[^1]: First.\n[^2]: Second.\n'

    expect(withoutFootnote(before, '1')).toBe('A and B[^2].\n\n[^2]: Second.\n')
  })

  it('drops the indented lines that continue a definition', () => {
    const before = [
      'Text[^note].',
      '',
      '[^note]: First line.',
      '  continued here.',
      '',
      'After.',
    ].join('\n')

    expect(withoutFootnote(before, 'note')).toBe(['Text.', '', '', 'After.'].join('\n'))
  })

  it('follows a definition across a blank line into further indented lines', () => {
    const before = [
      'Text[^a].',
      '',
      '[^a]: Body starts.',
      '',
      '  and continues after a blank line.',
      'Not part of it.',
    ].join('\n')

    expect(withoutFootnote(before, 'a')).toBe(['Text.', '', 'Not part of it.'].join('\n'))
  })

  it('treats a label with regex characters as literal text', () => {
    const before = 'See[^a.b] here.\n\n[^a.b]: Source.\n'

    expect(withoutFootnote(before, 'a.b')).toBe('See here.\n\n')
    // `.` must not match `x`, so a different label is left alone.
    expect(withoutFootnote('See[^axb] here.\n', 'a.b')).toBe('See[^axb] here.\n')
  })

  it('does not confuse a label with one that merely starts the same way', () => {
    const before = 'A[^1] and B[^10].\n\n[^1]: First.\n[^10]: Tenth.\n'

    expect(withoutFootnote(before, '1')).toBe('A and B[^10].\n\n[^10]: Tenth.\n')
  })

  it('returns the note unchanged when the label is not there', () => {
    const before = 'Nothing to remove.\n\n[^1]: Source.\n'

    expect(withoutFootnote(before, 'missing')).toBe(before)
  })
})
