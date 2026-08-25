/**
 * Which `[key:: value]` occurrences the Dataview migration recognises, and which it leaves
 * alone.
 *
 * The migration rewrites people's notes, so what counts as an inline field is worth stating
 * outright rather than leaving to a regex. These cases were written against the original
 * expression — which used lookbehind, unsupported on iOS before 16.4 — so that the same
 * behaviour could be shown to survive the rewrite that removed it.
 */
import { describe, it, expect } from 'vitest'
import { parseInlineFields, stripInlineFields } from '@/commands/migrateDataviewFields'

const keys = (content: string) => parseInlineFields(content).map((f) => f.key)
const pairs = (content: string) => parseInlineFields(content).map((f) => `${f.key}=${f.value}`)

describe('what counts as an inline field', () => {
  it('reads a field on its own', () => {
    expect(pairs('[status:: done]')).toEqual(['status=done'])
  })

  it('reads a field surrounded by prose', () => {
    expect(pairs('Some text [status:: done] and more')).toEqual(['status=done'])
  })

  it('reads several fields on one line', () => {
    expect(pairs('[a:: 1] middle [b:: 2]')).toEqual(['a=1', 'b=2'])
  })

  it('reads fields written back to back, with nothing between them', () => {
    expect(pairs('[a:: 1][b:: 2]')).toEqual(['a=1', 'b=2'])
  })

  it('reads a field at the very start of the content', () => {
    expect(pairs('[first:: yes] then text')).toEqual(['first=yes'])
  })

  it('trims the value', () => {
    expect(pairs('[key::   spaced   ]')).toEqual(['key=spaced'])
  })

  it('keeps an empty value', () => {
    expect(pairs('[key:: ]')).toEqual(['key='])
  })

  it('allows a value containing colons and brackets of its own', () => {
    expect(pairs('[url:: https://example.com:8080/a(b)]')).toEqual([
      'url=https://example.com:8080/a(b)',
    ])
  })
})

describe('what is left alone', () => {
  it('ignores a wiki link', () => {
    expect(keys('[[Some Note]]')).toEqual([])
  })

  it('ignores a wiki link that happens to contain the separator', () => {
    expect(keys('[[Note:: with colons]]')).toEqual([])
  })

  it('ignores a key ending in a space', () => {
    expect(keys('[key :: value]')).toEqual([])
  })

  it('ignores a key containing a colon', () => {
    expect(keys('[a:b:: value]')).toEqual([])
  })

  it('ignores a single colon', () => {
    expect(keys('[key: value]')).toEqual([])
  })

  it('ignores an empty key', () => {
    expect(keys('[:: value]')).toEqual([])
  })

  it('ignores a markdown link', () => {
    expect(keys('[label](https://example.com)')).toEqual([])
  })

  /**
   * The one shape where the check on the preceding character is what decides: a doubled
   * opening bracket with a single closing one. Everything else that looks like a wiki link is
   * already ruled out by the trailing `]`.
   */
  it('ignores a doubled opening bracket even when only one bracket closes it', () => {
    expect(keys('[[a:: 1]')).toEqual([])
    expect(keys('[[a:: 1] tail')).toEqual([])
    expect(keys('x[[a:: 1]')).toEqual([])
  })

  it('leaves a doubled opening bracket in place when removing fields', () => {
    expect(stripInlineFields('[[a:: 1] tail')).toBe('[[a:: 1] tail')
  })
})

describe('removing the fields it read', () => {
  it('takes out the whole occurrence', () => {
    expect(stripInlineFields('before [k:: v] after')).toBe('before  after')
  })

  it('takes out back-to-back occurrences', () => {
    expect(stripInlineFields('[a:: 1][b:: 2]')).toBe('')
  })

  it('leaves a wiki link in place', () => {
    expect(stripInlineFields('see [[Some Note]] here')).toBe('see [[Some Note]] here')
  })

  it('leaves the character before a field in place', () => {
    expect(stripInlineFields('x[k:: v]')).toBe('x')
    expect(stripInlineFields('(([k:: v]')).toBe('((')
  })

  it('removes only the fields, across several lines', () => {
    const before = 'Title\n[a:: 1]\nbody [b:: 2] tail\n[[Link]]\n'
    expect(stripInlineFields(before)).toBe('Title\n\nbody  tail\n[[Link]]\n')
  })

  it('removes every occurrence it reported, and nothing else', () => {
    const content = 'p [a:: 1] q [[L]] r [b:: 2] s'
    const found = parseInlineFields(content)
    const stripped = stripInlineFields(content)

    expect(found).toHaveLength(2)
    for (const field of found) {
      expect(stripped).not.toContain(`${field.key}::`)
    }
    expect(stripped).toContain('[[L]]')
    expect(stripped.startsWith('p ')).toBe(true)
    expect(stripped.endsWith(' s')).toBe(true)
  })
})
