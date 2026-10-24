import { expect, it, vi } from 'vitest'
import type { MetadataCache, TFile } from 'obsidian'
import { taskLinkOnLine } from '@/helpers/taskLinkDecision'

it.each([undefined, null])('preserves shape-only behavior when metadata is %s', (cache) => {
  expect(taskLinkOnLine('- [ ] [[Sample]]', 'Source.md', cache)).toBe('[[Sample]]')
  expect(taskLinkOnLine('- [ ] ordinary text', 'Source.md', cache)).toBeNull()
})

it.each(['task', 'note', undefined, ['task']])('uses the indexed exact type %s', (type) => {
  const file = { path: 'Folder/Sample.md' } as TFile
  const cache = {
    getFirstLinkpathDest: vi.fn(() => file),
    getFileCache: vi.fn(() => ({ frontmatter: { type } })),
  }
  expect(
    taskLinkOnLine('- [ ] [[Sample|Alias]]', 'Folder/Source.md', cache as unknown as MetadataCache)
  ).toBe(type === 'task' ? '[[Sample|Alias]]' : null)
  expect(cache.getFirstLinkpathDest).toHaveBeenCalledWith('Sample', 'Folder/Source.md')
  expect(cache.getFileCache).toHaveBeenCalledWith(file)
})

it('keeps missing links as task creation cards and ignores other lines without resolving', () => {
  const cache = { getFirstLinkpathDest: vi.fn(() => null), getFileCache: vi.fn() }
  expect(taskLinkOnLine('- [ ] [[Missing]]', 'Source.md', cache as unknown as MetadataCache)).toBe(
    '[[Missing]]'
  )
  for (const line of ['[[Sample]]', '- [ ] text [[Sample]]', '- [ ] [[One]] [[Two]]'])
    expect(taskLinkOnLine(line, 'Source.md', cache as unknown as MetadataCache)).toBeNull()
  expect(cache.getFirstLinkpathDest).toHaveBeenCalledTimes(1)
  expect(cache.getFileCache).not.toHaveBeenCalled()
})

it('resolves headings relative to the source and keeps uncached existing files native', () => {
  const cache = {
    getFirstLinkpathDest: vi.fn(() => ({ path: 'Folder/Sample.md' })),
    getFileCache: vi.fn(() => null),
  }
  expect(
    taskLinkOnLine(
      '- [ ] [[Sample#Section|Alias]]',
      'Folder/Source.md',
      cache as unknown as MetadataCache
    )
  ).toBeNull()
  expect(cache.getFirstLinkpathDest).toHaveBeenCalledWith('Sample', 'Folder/Source.md')
})
