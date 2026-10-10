/**
 * Opening the form modal from outside a script.
 *
 * The presentation adapter records the request-local props passed to the on-demand host.
 * The queue's guarantees are unchanged: each caller receives its own answer, in order,
 * with no shared UI-store fields. The real mounted host is covered at component level.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { showFormModal, showMarkdown } from '@/scripting/formModal'
import type { FormField } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

const presentation = vi.hoisted(() => ({
  scriptFormModalOpened: { value: false },
  scriptFormId: { value: 0 },
  scriptFormFields: { value: [] as FormField[] },
  scriptFormResolve: { value: null as ((values: Record<string, string> | null) => void) | null },
}))
vi.mock('@/modal/componentDialog', () => ({
  openComponentDialog: (
    _load: unknown,
    props: { fields: FormField[]; resolve: (values: Record<string, string> | null) => void },
    options: { onClosed: () => void }
  ) => {
    presentation.scriptFormId.value++
    presentation.scriptFormFields.value = props.fields
    presentation.scriptFormResolve.value = props.resolve
    presentation.scriptFormModalOpened.value = true
    let closed = false
    return {
      ready: Promise.resolve(),
      close() {
        if (closed) return
        closed = true
        presentation.scriptFormModalOpened.value = false
        presentation.scriptFormResolve.value = null
        options.onClosed()
      },
    }
  },
}))
const store = () => presentation

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

afterEach(() => answer(null))

describe('showing a form', () => {
  // BUG: the second request replaces the shared fields and resolver, stranding the first caller.
  it('keeps two simultaneous forms in order and settles each caller once', async () => {
    const results: Array<unknown> = []
    const first = showFormModal([{ name: 'first', label: 'First', type: 'text' }]).then((value) =>
      results.push(['first', value])
    )
    const firstResolve = store().scriptFormResolve.value
    const second = showFormModal([{ name: 'second', label: 'Second', type: 'text' }]).then(
      (value) => results.push(['second', value])
    )
    const secondResolve = store().scriptFormResolve.value
    try {
      expect(store().scriptFormFields.value.map((field) => field.name)).toEqual(['first'])
      store().scriptFormResolve.value?.({ first: 'one' })
      await Promise.resolve()
      expect(results).toEqual([['first', { first: 'one' }]])
      expect(store().scriptFormFields.value.map((field) => field.name)).toEqual(['second'])
      store().scriptFormResolve.value?.({ second: 'two' })
      await Promise.resolve()
      expect(results).toEqual([
        ['first', { first: 'one' }],
        ['second', { second: 'two' }],
      ])
    } finally {
      firstResolve?.(null)
      secondResolve?.(null)
      store().scriptFormResolve.value?.(null)
      await Promise.all([first, second])
      store().scriptFormModalOpened.value = false
    }
  })

  it('can cancel a queued form without closing the active one', async () => {
    const controller = new AbortController()
    const first = showFormModal([{ name: 'first', label: 'First', type: 'text' }])
    const cancelled = showFormModal([], undefined, controller.signal)
    const rejected = expect(cancelled).rejects.toThrow('Script stopped')
    controller.abort()
    await rejected
    expect(store().scriptFormFields.value[0].name).toBe('first')
    expect(store().scriptFormModalOpened.value).toBe(true)
    answer({ first: 'one' })
    await expect(first).resolves.toEqual({ first: 'one' })
  })

  it('cancels the active form and opens a fresh instance for the next caller', async () => {
    const controller = new AbortController()
    const first = showFormModal([], undefined, controller.signal)
    const rejected = expect(first).rejects.toThrow('Script stopped')
    const id = store().scriptFormId.value
    const staleAnswer = store().scriptFormResolve.value
    const second = showFormModal([{ name: 'next', label: 'Next', type: 'text' }])
    controller.abort()
    await rejected
    expect(store().scriptFormId.value).toBeGreaterThan(id)
    staleAnswer?.(null)
    expect(store().scriptFormModalOpened.value).toBe(true)
    answer({ next: 'two' })
    await expect(second).resolves.toEqual({ next: 'two' })
  })

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
