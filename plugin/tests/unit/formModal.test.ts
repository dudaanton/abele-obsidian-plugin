/**
 * Opening the form modal from outside a script.
 *
 * The modal is one Vue component mounted inside the plugin's root, watching three refs in the
 * store; showing a form is writing to them and waiting. That was a private method on
 * `ScriptService`, which meant anything else wanting a modal — the API reference command —
 * would have had to write those refs itself and drift from how scripts do it.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { showFormModal, showMarkdown } from '@/scripting/formModal'
import { GlobalStore } from '@/stores/GlobalStore'
import type { FormField } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

const store = () => GlobalStore.getInstance()

/** Answer the modal the way closing it does, so a pending promise settles. */
const answer = (result: Record<string, string> | null) => {
  store().scriptFormResolve.value?.(result)
  store().scriptFormModalOpened.value = false
}

beforeEach(() => {
  useVault([])
  store().scriptFormModalOpened.value = false
  store().scriptFormFields.value = []
  store().scriptFormResolve.value = null
})

describe('showing a form', () => {
  it('opens the modal on the fields it was given', () => {
    const fields: FormField[] = [{ name: 'query', label: 'Query', type: 'text' }]

    void showFormModal(fields)

    expect(store().scriptFormModalOpened.value).toBe(true)
    expect(store().scriptFormFields.value).toEqual(fields)
  })

  it('resolves with the answer', async () => {
    const pending = showFormModal([{ name: 'query', label: 'Query', type: 'text' }])

    answer({ query: 'moths' })

    await expect(pending).resolves.toEqual({ query: 'moths' })
  })

  it('resolves with nothing when the form is dismissed', async () => {
    const pending = showFormModal([{ name: 'query', label: 'Query', type: 'text' }])

    answer(null)

    await expect(pending).resolves.toBeNull()
  })
})

describe('showing markdown', () => {
  it('is a form of one field that asks nothing', () => {
    void showMarkdown('# Report\n\nAll **good**.')

    expect(store().scriptFormFields.value).toEqual([
      { name: 'text', label: '', type: 'markdown', text: '# Report\n\nAll **good**.' },
    ])
  })

  it('carries the title as the label the modal takes its heading from', () => {
    void showMarkdown('Body.', 'Script API')

    expect(store().scriptFormFields.value[0].label).toBe('Script API')
  })

  it('waits for the modal to be closed, and answers nothing itself', async () => {
    let done = false
    const pending = showMarkdown('Body.').then(() => {
      done = true
    })

    expect(done).toBe(false)
    answer(null)
    await pending

    expect(done).toBe(true)
  })
})
