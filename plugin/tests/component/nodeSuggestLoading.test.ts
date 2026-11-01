import { expect, it, vi } from 'vitest'
import { NodeSuggestModal } from '@/components/nodeWork/NodeSuggestModal'
import { useVault } from '../helpers/testEnv'

it('uses the native empty-state loading text without clearing the query or cached suggestions', () => {
  const picker = new NodeSuggestModal(
    useVault([]) as never,
    [{ id: 'sample', icon: 'folder', kind: 'Folder', title: 'Sample folder' }],
    'Choose folder',
    vi.fn(),
    'No folder or branch matches'
  )
  const results = document.createElement('div')
  picker.contentEl.append(results)
  Object.assign(picker, { resultContainerEl: results })
  picker.inputEl.value = 'sample'
  picker.setLoading(true)
  picker.setLoading(true)
  expect(picker.emptyStateText).toBe('Loading…')
  expect(picker.contentEl.querySelector('progress')).toBeNull()
  expect(results.getAttribute('aria-busy')).toBe('true')
  expect(picker.getSuggestions('sample')).toHaveLength(1)
  picker.setItems([{ id: 'new', icon: 'folder', kind: 'Folder', title: 'New sample' }])
  expect(picker.inputEl.value).toBe('sample')
  expect(picker.getSuggestions('sample')[0].id).toBe('new')
  picker.setLoading(false)
  expect(picker.contentEl.querySelector('progress.abele-progress')).toBeNull()
  expect(results.getAttribute('aria-busy')).toBe('false')
  expect(picker.emptyStateText).toBe('No folder or branch matches')
  picker.setLoading(true)
  picker.setItems([], 'Nothing here')
  expect(picker.emptyStateText).toBe('Loading…')
  picker.setLoading(false)
  expect(picker.emptyStateText).toBe('Nothing here')
  picker.setLoading(true)
  picker.onClose()
  expect(picker.contentEl.querySelector('progress')).toBeNull()
})
