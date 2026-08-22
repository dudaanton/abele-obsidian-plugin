import { describe, it, expect } from 'vitest'
import {
  normalizePath,
  getFileNameFromPath,
  getNameFromPath,
  getFolderFromPath,
  isPath,
  comparePaths,
  isWikilink,
  wikilinkToPath,
  extractAliasOrNameFromWikilink,
  pathToWikilink,
  ensureWikilinkAlias,
  removeAliasFromWikilink,
  cleanFileName,
  cleanNoteName,
  resolvePath,
  escapeRegExp,
} from '@/helpers/pathsHelpers'

describe('normalizePath', () => {
  it('appends .md when missing', () => {
    expect(normalizePath('People/Ann')).toBe('People/Ann.md')
  })

  it('leaves an existing .md extension alone', () => {
    expect(normalizePath('People/Ann.md')).toBe('People/Ann.md')
  })

  it('strips surrounding slashes and whitespace', () => {
    expect(normalizePath('  /People/Ann/  ')).toBe('People/Ann.md')
  })

  it('treats a non-md extension as part of the name', () => {
    expect(normalizePath('Assets/photo.png')).toBe('Assets/photo.png.md')
  })
})

describe('getFileNameFromPath / getNameFromPath / getFolderFromPath', () => {
  it('extracts the file name with extension', () => {
    expect(getFileNameFromPath('A/B/Note.md')).toBe('Note.md')
  })

  it('extracts the file name without the .md extension', () => {
    expect(getNameFromPath('A/B/Note.md')).toBe('Note')
  })

  it('keeps a non-md extension in the bare name', () => {
    expect(getNameFromPath('A/B/photo.png')).toBe('photo.png')
  })

  it('returns an empty folder for a bare file name', () => {
    expect(getFolderFromPath('Note.md')).toBe('')
  })

  it('returns the parent folder for a nested path', () => {
    expect(getFolderFromPath('A/B/Note.md')).toBe('A/B')
  })
})

describe('isPath', () => {
  it.each([
    ['A/B.md', true],
    ['B.md', false],
  ])('isPath(%s) === %s', (input, expected) => {
    expect(isPath(input)).toBe(expected)
  })
})

describe('comparePaths', () => {
  it('matches identical full paths regardless of extension and slashes', () => {
    expect(comparePaths('/A/B/Note/', 'A/B/Note.md')).toBe(true)
  })

  it('falls back to name-only comparison when either side is a bare name', () => {
    expect(comparePaths('Note', 'A/B/Note.md')).toBe(true)
  })

  it('does not match different files in the same folder', () => {
    expect(comparePaths('A/One.md', 'A/Two.md')).toBe(false)
  })

  it('matches same-named files in different folders only via the bare-name path', () => {
    // Both sides are full paths, so the name-only shortcut does not apply.
    expect(comparePaths('A/Note.md', 'B/Note.md')).toBe(false)
  })
})

describe('isWikilink', () => {
  it.each([
    ['[[Parks Department]]', true],
    ['[[A/B|Alias]]', true],
    ['Parks Department', false],
    ['[[]]', false],
    ['', false],
  ])('isWikilink(%j) === %s', (input, expected) => {
    expect(isWikilink(input)).toBe(expected)
  })

  it('is defensive about non-string input', () => {
    expect(isWikilink(null as unknown as string)).toBe(false)
    expect(isWikilink(42 as unknown as string)).toBe(false)
  })
})

describe('wikilinkToPath', () => {
  // Group scope resolution compares this output against a stored vault path, so the
  // implicit .md normalisation here is load-bearing, not cosmetic.
  it('normalises a bare wikilink to an .md path', () => {
    expect(wikilinkToPath('[[Parks Department]]')).toBe('Parks Department.md')
  })

  it('drops the alias', () => {
    expect(wikilinkToPath('[[People/Ann|Ann Perkins]]')).toBe('People/Ann.md')
  })

  it('returns null when there is no wikilink', () => {
    expect(wikilinkToPath('Parks Department')).toBeNull()
  })

  it('picks the first wikilink when several are present', () => {
    expect(wikilinkToPath('[[One]] and [[Two]]')).toBe('One.md')
  })
})

describe('extractAliasOrNameFromWikilink', () => {
  it('returns the alias when present', () => {
    expect(extractAliasOrNameFromWikilink('[[People/Ann|Ann Perkins]]')).toBe('Ann Perkins')
  })

  it('returns the bare file name when no alias is present', () => {
    expect(extractAliasOrNameFromWikilink('[[People/Ann]]')).toBe('Ann')
  })

  it('returns null for a non-wikilink', () => {
    expect(extractAliasOrNameFromWikilink('People/Ann')).toBeNull()
  })
})

describe('pathToWikilink', () => {
  it('strips .md and defaults the alias to the file name', () => {
    expect(pathToWikilink('People/Ann.md')).toBe('[[People/Ann|Ann]]')
  })

  it('uses an explicit alias', () => {
    expect(pathToWikilink('People/Ann.md', 'Ann Perkins')).toBe('[[People/Ann|Ann Perkins]]')
  })
})

describe('ensureWikilinkAlias', () => {
  it('adds the file name as alias when absent', () => {
    expect(ensureWikilinkAlias('[[People/Ann]]')).toBe('[[People/Ann|Ann]]')
  })

  it('leaves an existing alias untouched', () => {
    expect(ensureWikilinkAlias('[[People/Ann|Ann Perkins]]')).toBe('[[People/Ann|Ann Perkins]]')
  })

  it('returns non-wikilink input unchanged', () => {
    expect(ensureWikilinkAlias('People/Ann')).toBe('People/Ann')
  })
})

describe('removeAliasFromWikilink', () => {
  it('strips the alias', () => {
    expect(removeAliasFromWikilink('[[People/Ann|Ann Perkins]]')).toBe('[[People/Ann]]')
  })

  it('leaves an alias-free wikilink unchanged', () => {
    expect(removeAliasFromWikilink('[[People/Ann]]')).toBe('[[People/Ann]]')
  })
})

describe('cleanFileName', () => {
  it('removes characters that are illegal in file names', () => {
    expect(cleanFileName('a[b]c/d\\e?f%g*h:i|j"k<l>m')).toBe('abcdefghijklm')
  })

  it('keeps only the first line and collapses whitespace', () => {
    expect(cleanFileName('  Some   Note  \nsecond line')).toBe('Some Note')
  })
})

describe('cleanNoteName', () => {
  it('replaces a wikilink with its alias', () => {
    expect(cleanNoteName('Meeting with [[People/Ann|Ann Perkins]]')).toBe(
      'Meeting with Ann Perkins'
    )
  })

  it('replaces an alias-free wikilink with its target text', () => {
    expect(cleanNoteName('Meeting with [[Ann]]')).toBe('Meeting with Ann')
  })
})

describe('resolvePath', () => {
  it('joins folder and name', () => {
    expect(resolvePath('People', 'Ann')).toBe('People/Ann.md')
  })

  it('handles an empty folder', () => {
    expect(resolvePath('', 'Ann')).toBe('Ann.md')
  })

  it('trims stray slashes on both sides', () => {
    expect(resolvePath('/People/', '/Ann/')).toBe('People/Ann.md')
  })
})

describe('escapeRegExp', () => {
  it('escapes regex metacharacters so the string matches literally', () => {
    const escaped = escapeRegExp('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')
    expect(new RegExp(`^${escaped}$`).test('a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o')).toBe(true)
  })
})
