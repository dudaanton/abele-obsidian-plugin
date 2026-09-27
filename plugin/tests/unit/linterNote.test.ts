/**
 * A note taken apart for the linter's rules, and the text edits their fixes are made of.
 */
import { describe, it, expect } from 'vitest'
import {
  readNote,
  slippedProperties,
  withProperty,
  withoutProperty,
  proseLines,
  keyAndDefault,
} from '@/linter/note'

const note = (content: string, path = 'Folder/Some note.md') => readNote(content, { path })

describe('reading a note', () => {
  it('finds the properties, the body and where each starts', () => {
    const n = note('---\ntype: task\ncreated: 2026-09-27\n---\n\nText\n')
    expect(n.name).toBe('Some note')
    expect(n.folder).toBe('Folder')
    expect(n.hasFrontmatter).toBe(true)
    expect(n.frontmatter).toEqual({ type: 'task', created: '2026-09-27' })
    expect(n.frontmatterEnd).toBe(4)
    expect(n.bodyStart).toBe(5)
    expect(n.body).toBe('\nText\n')
  })

  it('keeps a date the string it was typed as', () => {
    expect(note('---\ndue: 2026-10-01\n---\n').frontmatter).toEqual({ due: '2026-10-01' })
  })

  it('reads an empty block as no properties rather than an error', () => {
    const n = note('---\n---\nText')
    expect(n.frontmatter).toEqual({})
    expect(n.frontmatterError).toBe('')
  })

  it('says a block that is never closed is one', () => {
    const n = note('---\ntype: task\nText')
    expect(n.hasFrontmatter).toBe(true)
    expect(n.frontmatter).toBeNull()
    expect(n.frontmatterError).toMatch(/never closed/)
    expect(n.bodyStart).toBe(1)
  })

  it('says why broken YAML cannot be read, and on which line', () => {
    const n = note('---\ntype: task\ntitle: "open\nmore: x\n---\n')
    expect(n.frontmatter).toBeNull()
    expect(n.frontmatterError).not.toBe('')
    expect(n.frontmatterErrorLine).toBeGreaterThanOrEqual(3)
  })

  it('refuses a key given twice, as Obsidian does', () => {
    const n = note('---\ntype: task\ntype: note\n---\n')
    expect(n.frontmatter).toBeNull()
    expect(n.frontmatterError).toMatch(/duplicate/)
  })

  it('refuses a block that is a list rather than properties', () => {
    expect(note('---\n- a\n- b\n---\n').frontmatterError).toMatch(/not a list of names/)
  })

  it('has no properties without a fence on the first line', () => {
    const n = note('\n---\ntype: task\n---\n')
    expect(n.hasFrontmatter).toBe(false)
    expect(n.bodyStart).toBe(1)
  })

  it('keeps Windows line breaks out of the lines', () => {
    const n = note('---\r\ntype: task\r\n---\r\nText')
    expect(n.frontmatter).toEqual({ type: 'task' })
    expect(n.lines).toEqual(['---', 'type: task', '---', 'Text'])
  })
})

describe('a properties block that slipped', () => {
  it('is found below blank lines', () => {
    expect(slippedProperties(note('\n\n---\ntype: task\n---\nText'))).toEqual({
      start: 3,
      end: 5,
      onlyBlankAbove: true,
    })
  })

  it('is found behind a byte-order mark', () => {
    expect(slippedProperties(note('\uFEFF---\ntype: task\n---\n'))?.start).toBe(1)
  })

  it('is found below text put above it', () => {
    const found = slippedProperties(
      note('Pasted line\n---\ntype: task\ncreated: 2026-09-01\n---\n')
    )
    expect(found).toEqual({ start: 2, end: 5, onlyBlankAbove: false })
  })

  it('is not two horizontal rules around a paragraph', () => {
    expect(slippedProperties(note('Intro\n---\nA paragraph, with words.\n---\n'))).toBeNull()
  })

  it('is not looked for in a note that has properties where they belong', () => {
    expect(slippedProperties(note('---\na: 1\n---\n---\nb: 2\n---\n'))).toBeNull()
  })
})

describe('changing one property', () => {
  it('adds it at the end of the block, leaving the rest as it was', () => {
    const before = '---\n# kept\ntitle: "Quoted"\n---\n\nBody'
    expect(withProperty(before, 'created', '2026-09-27')).toBe(
      '---\n# kept\ntitle: "Quoted"\ncreated: 2026-09-27\n---\n\nBody'
    )
  })

  it('replaces the lines of one already there, a list included', () => {
    const before = '---\ntags:\n  - a\n  - b\ntype: note\n---\n'
    expect(withProperty(before, 'tags', ['c'])).toBe('---\ntags:\n  - c\ntype: note\n---\n')
  })

  it('makes a block for a note without one, a blank line under it', () => {
    expect(withProperty('Body\n', 'created', '2026-09-27')).toBe(
      '---\ncreated: 2026-09-27\n---\n\nBody\n'
    )
    expect(withProperty('', 'type', 'note')).toBe('---\ntype: note\n---\n')
  })

  it('keeps the line breaks the file uses', () => {
    expect(withProperty('---\r\na: 1\r\n---\r\n', 'b', 2)).toBe('---\r\na: 1\r\nb: 2\r\n---\r\n')
  })

  it('takes a property out with its list and nothing else', () => {
    const before = '---\ntype: note\ntags:\n- a\n- b\ncreated: 2026-01-01\n---\nText'
    expect(withoutProperty(before, 'tags')).toBe('---\ntype: note\ncreated: 2026-01-01\n---\nText')
  })

  it('takes out a quoted key, and leaves a comment after the last property', () => {
    expect(withoutProperty('---\n"tags": [a]\n# note\n---\n', 'tags')).toBe('---\n# note\n---\n')
  })

  it('leaves a note alone when the property is not there', () => {
    const text = '---\na: 1\n---\n'
    expect(withoutProperty(text, 'b')).toBe(text)
    expect(withoutProperty('No block', 'a')).toBe('No block')
  })
})

describe('helpers', () => {
  it('reads a list entry as a key and its default', () => {
    expect(keyAndDefault('created')).toEqual({ key: 'created', value: null })
    expect(keyAndDefault('type: note')).toEqual({ key: 'type', value: 'note' })
    expect(keyAndDefault('when: {{ctime}}')).toEqual({ key: 'when', value: '{{ctime}}' })
  })

  it('gives the body outside fenced code, numbered over the whole file', () => {
    const n = note('---\na: 1\n---\n# Title\n```\n# not a heading\n```\n## After')
    expect(proseLines(n)).toEqual([
      { line: 4, text: '# Title' },
      { line: 8, text: '## After' },
    ])
  })
})

describe('a property changed next to a comment', () => {
  it('keeps the comment on the property’s own line', () => {
    expect(
      withProperty('---\ncreated: "" # why it was empty\n---\n', 'created', '2026-01-02')
    ).toBe('---\ncreated: 2026-01-02 # why it was empty\n---\n')
  })

  it('does not take a hash inside quotes for a comment', () => {
    expect(withProperty('---\ncreated: "a # b"\n---\n', 'created', '2026-01-02')).toBe(
      '---\ncreated: 2026-01-02\n---\n'
    )
  })
})
