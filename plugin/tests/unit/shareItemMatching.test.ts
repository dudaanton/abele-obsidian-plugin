import { expect, it } from 'vitest'
import { matchingShareItems } from '@/helpers/suggesters/ShareItemSuggest'
import type { ShareItem } from '@/sync/shareSets'

it('keeps an exact folder path selectable beyond fifty matching children', () => {
  const folder: ShareItem = { id: 'sample-folder', kind: 'folder', path: 'Sample/Shared' }
  const children: ShareItem[] = Array.from({ length: 1000 }, (_, index) => ({
    id: 'sample-' + index,
    kind: 'file',
    path: folder.path + '/Note ' + index + '.md',
  }))
  const choices = [...children, folder]
  const before = choices.slice()
  const matches = matchingShareItems(choices, [], folder.path)
  expect(matches).toHaveLength(50)
  expect(matches[0]).toBe(folder)
  expect(choices).toEqual(before)
})

it('prioritizes exact names while preserving covered and already selected rules', () => {
  const folder: ShareItem = { id: 'sample-folder', kind: 'folder', path: 'Sample/Shared' }
  const file: ShareItem = { id: 'sample-file', kind: 'file', path: 'Other/Shared.md' }
  const partial: ShareItem = { id: 'sample-partial', kind: 'file', path: 'Other/Shared draft.md' }
  expect(matchingShareItems([partial, folder, file], [], 'Shared')).toEqual([folder, file, partial])
  expect(matchingShareItems([partial, folder, file], [folder], folder.path)).toEqual([])
})
