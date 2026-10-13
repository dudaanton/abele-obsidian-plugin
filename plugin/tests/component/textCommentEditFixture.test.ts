import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { openDialog } from '@/testing/openDialog'
import { useVault } from '../helpers/testEnv'

afterEach(() => {
  document.body.replaceChildren()
})

describe('text comment edit fixture', () => {
  it('opens the thread with its first comment being changed where it stands', async () => {
    useVault([])
    await openDialog('text-comment-edit')
    await flushPromises()
    const editing = document.querySelector('.abele-text-comments__entry.is-editing')
    expect(editing?.getAttribute('data-entry-id')).toBe('000001')
    expect(editing?.querySelector('.abele-note-editor-field__editor')).not.toBeNull()
  })
})
