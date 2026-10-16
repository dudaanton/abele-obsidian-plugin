import { expect, it } from 'vitest'
import { ignoreFor, withinSyncPath } from '@/sync/scope'

it('compares scope and held prefixes in NFC without changing case or segment boundaries', () => {
  const folder = 'Sample/й-ё'
  expect(withinSyncPath(folder.normalize('NFD') + '/note.md', folder)).toBe(true)
  expect(withinSyncPath(folder, folder.normalize('NFD'))).toBe(true)
  expect(withinSyncPath(folder + '-other/note.md', folder.normalize('NFD'))).toBe(false)
  expect(withinSyncPath('sample/й-ё/note.md', folder)).toBe(false)
})

it('matches NFD ignore literals and exceptions without excluding adjacent folders', () => {
  const rules = ignoreFor('.obsidian', 'й-folder/\n!й-folder/ё-keep.md\n'.normalize('NFD'))
  expect(rules.ignores('й-folder/other.md')).toBe(true)
  expect(rules.ignores('й-folder/other.md'.normalize('NFD'))).toBe(true)
  expect(rules.ignores('й-folder/ё-keep.md')).toBe(false)
  expect(rules.ignores('й-folder-other/other.md')).toBe(false)
})
