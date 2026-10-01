import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { openExternal } from '@/helpers/openExternal'

afterEach(() => vi.restoreAllMocks())
it.each([
  'javascript:sample()',
  'java\nscript:sample()',
  'obsidian://abele?path=sample-note',
  'file:///sample',
  'data:text/html,sample',
  'sample-relative',
])('does not launch %s', (url) => {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  expect(openExternal(url)).toBe(false)
  expect(open).not.toHaveBeenCalled()
})
it.each(['https://example.org/sample', 'http://example.org/sample', 'mailto:sample@example.org'])(
  'opens %s',
  (url) => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    expect(openExternal(url)).toBe(true)
    expect(open).toHaveBeenCalledWith(url)
  }
)
it('routes every direct browser opening through the scheme check', () => {
  const root = resolve(__dirname, '../../src')
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? entry.name === 'vendor'
          ? []
          : files(resolve(dir, entry.name))
        : /\.(ts|vue)$/.test(entry.name)
          ? [resolve(dir, entry.name)]
          : []
    )
  const direct = files(root)
    .filter((file) => /\b(?:window|activeWindow)\.open\(/.test(readFileSync(file, 'utf8')))
    .map((file) => relative(root, file))
  expect(direct).toEqual(['helpers/openExternal.ts'])
})
