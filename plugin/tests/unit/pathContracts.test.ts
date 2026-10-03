import { describe, expect, it } from 'vitest'
import {
  normalizeMarkdownPath,
  normalizePath,
  cleanFileName,
  toSafeVaultPath,
  resolvePath,
} from '@/helpers/pathsHelpers'

describe('explicit note-path and filename policies', () => {
  it.each([
    [' /Notes/sample/ ', 'Notes/sample.md'],
    ['Notes/sample.md', 'Notes/sample.md'],
    ['sample.MD', 'sample.MD.md'],
    ['sample.png', 'sample.png.md'],
    ['', '.md'],
  ])('normalizes the markdown path %s without claiming host normalization', (input, expected) => {
    expect(normalizeMarkdownPath(input)).toBe(expected)
    expect(normalizePath(input)).toBe(expected)
  })

  it('keeps legacy title cleaning separate from safe vault-path cleaning', () => {
    const title = '100% sample #part [x]: next\nignored'
    expect(cleanFileName(title)).toBe('100 sample part x next')
    expect(toSafeVaultPath('Notes/100% sample #part [x]: next.md')).toBe(
      'Notes/100% sample part x next.md'
    )
    expect(toSafeVaultPath('###/sample.md')).toBe('Untitled/sample.md')
    expect(resolvePath(' /Notes/ ', ' /sample/ ')).toBe('Notes/sample.md')
  })
})
