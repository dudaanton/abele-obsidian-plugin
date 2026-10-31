import { expect, it, vi } from 'vitest'
import { NodeSuggestModal } from '@/components/nodeWork/NodeSuggestModal'
import { useVault } from '../helpers/testEnv'

it('uses one native progress bar without clearing the query or cached suggestions', () => {
  const picker = new NodeSuggestModal(
    useVault([]) as never,
    [{ id: 'sample', icon: 'folder', kind: 'Folder', title: 'Sample folder' }],
    'Choose folder',
    vi.fn()
  )
  const results = document.createElement('div')
  picker.contentEl.append(results)
  Object.assign(picker, { resultContainerEl: results })
  picker.inputEl.value = 'sample'
  picker.setLoading(true)
  picker.setLoading(true)
  expect(picker.contentEl.querySelectorAll('progress.abele-progress')).toHaveLength(1)
  expect(results.getAttribute('aria-busy')).toBe('true')
  expect(picker.contentEl.querySelector('progress')?.hasAttribute('value')).toBe(false)
  expect(picker.getSuggestions('sample')).toHaveLength(1)
  picker.setItems([{ id: 'new', icon: 'folder', kind: 'Folder', title: 'New sample' }])
  expect(picker.inputEl.value).toBe('sample')
  expect(picker.getSuggestions('sample')[0].id).toBe('new')
  picker.setLoading(false)
  expect(picker.contentEl.querySelector('progress.abele-progress')).toBeNull()
  expect(results.getAttribute('aria-busy')).toBe('false')
  picker.setLoading(true)
  picker.onClose()
  expect(picker.contentEl.querySelector('progress')).toBeNull()
})
