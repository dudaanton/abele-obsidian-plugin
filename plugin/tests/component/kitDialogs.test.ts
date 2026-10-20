/**
 * The kit's promise-returning dialogs: code that is not a Vue component asks and awaits the
 * reply through `confirmDialog`, `promptDialog` and `choiceDialog`, each a kit component in the
 * shell. Any way of closing one other than its answer is no answer.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { closeComponentDialogs } from '@/modal/componentDialog'
import {
  choiceDialog,
  confirmDialog,
  openDialog,
  promptDialog,
} from '@/components/obsidian/dialogs'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(() => {
  closeComponentDialogs()
  document.body.replaceChildren()
})

const modal = () => document.querySelector<HTMLElement>('.modal.abele-modal')
const buttons = () =>
  [...document.querySelectorAll<HTMLButtonElement>('.modal button')].map((b) =>
    b.textContent?.trim()
  )
const press = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('.modal button')]
    .find((b) => b.textContent?.trim() === text)!
    .click()
const field = () => document.querySelector<HTMLInputElement>('.modal input')!
const type = (value: string) => {
  field().value = value
  field().dispatchEvent(new Event('input'))
}
const enter = () =>
  field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

it('keeps confirmation files collapsed until asked, with relative paths and recovery markers', async () => {
  const reply = confirmDialog({
    title: 'Delete folder',
    message: 'Delete folder src with 31 files in 2 folders?',
    details: {
      label: 'Show files',
      notice: 'Changed contents cannot be recovered from Git.',
      items: [
        { path: 'nested/sample.ts', badge: 'Uncommitted' },
        { path: 'draft.ts', badge: 'Untracked' },
      ],
    },
  })
  await flushPromises()
  expect(modal()?.textContent).toContain('31 files in 2 folders')
  expect(modal()?.textContent).not.toContain('nested/sample.ts')
  const control = modal()!.querySelector<HTMLElement>('[aria-expanded="false"]')!
  expect(control.textContent).toContain('Show files')
  control.click()
  await flushPromises()
  expect(modal()?.textContent).toContain('nested/sample.ts')
  expect(modal()?.textContent).toContain('Uncommitted')
  expect(modal()?.textContent).toContain('Untracked')
  press('Cancel')
  await expect(reply).resolves.toBe(false)
})

describe('openDialog', () => {
  const asking = defineComponent({
    emits: ['answer', 'close'],
    setup:
      (_p, { emit }) =>
      () =>
        h('div', [
          h('button', { onClick: () => (emit('answer', 'sample'), emit('close')) }, 'Pick'),
          h('button', { onClick: () => emit('close') }, 'Leave'),
        ]),
  })

  it('resolves with the answer the component gave', async () => {
    const reply = openDialog(asking)
    await flushPromises()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent === 'Pick')!.click()
    await expect(reply).resolves.toBe('sample')
    expect(document.querySelector('[data-abele-dialog-host]')).toBeNull()
  })

  it('resolves with nothing when closed without an answer', async () => {
    const reply = openDialog(asking)
    await flushPromises()
    ;[...document.querySelectorAll('button')].find((b) => b.textContent === 'Leave')!.click()
    await expect(reply).resolves.toBeUndefined()
  })

  it('closes unanswered when its signal aborts, and opens nothing for an aborted one', async () => {
    const controller = new AbortController()
    const reply = openDialog(asking, {}, { signal: controller.signal })
    await flushPromises()
    controller.abort()
    await expect(reply).resolves.toBeUndefined()
    expect(document.querySelector('button')).toBeNull()
    await expect(openDialog(asking, {}, { signal: controller.signal })).resolves.toBeUndefined()
    await flushPromises()
    expect(document.querySelector('button')).toBeNull()
  })

  it('resolves with nothing when the plugin unloads under it', async () => {
    const reply = openDialog(asking)
    await flushPromises()
    closeComponentDialogs()
    await expect(reply).resolves.toBeUndefined()
  })
})

describe('confirmDialog', () => {
  it('shows the message with Cancel and the named action, and says yes only for the action', async () => {
    const reply = confirmDialog({
      title: 'Remove sample?',
      message: 'The sample note goes.',
      confirmText: 'Remove',
    })
    await flushPromises()
    expect(document.querySelector('.abele-confirm__message')?.textContent).toBe(
      'The sample note goes.'
    )
    expect(buttons()).toEqual(['Cancel', 'Remove'])
    expect(document.querySelector('.modal .mod-warning')?.textContent?.trim()).toBe('Remove')
    press('Remove')
    await expect(reply).resolves.toBe(true)
    expect(modal()).toBeNull()
  })

  it('is on screen as soon as it is asked, as the shell dialogs were', () => {
    void confirmDialog({ title: 'Delete?', message: 'Sample' })
    expect(document.querySelector('.abele-confirm__message')?.textContent).toBe('Sample')
  })

  it('is a no when cancelled', async () => {
    const reply = confirmDialog({ title: 'Delete?', message: 'Sample' })
    await flushPromises()
    expect(buttons()).toEqual(['Cancel', 'Delete'])
    press('Cancel')
    await expect(reply).resolves.toBe(false)
  })
})

describe('promptDialog', () => {
  it('focuses the field and answers its trimmed text on Create', async () => {
    const reply = promptDialog({ title: 'New script', value: 'draft' })
    await flushPromises()
    expect(field().value).toBe('draft')
    expect(field().placeholder).toBe('filename')
    expect(document.activeElement).toBe(field())
    expect(buttons()).toEqual(['Cancel', 'Create'])
    expect(modal()?.classList.contains('abele-modal_footer-dismiss')).toBe(true)
    expect(document.querySelector('.modal .mod-cta')?.textContent?.trim()).toBe('Create')
    type('  sample-script  ')
    press('Create')
    await expect(reply).resolves.toBe('sample-script')
  })

  it('leaves the caret out of the field when asked to', async () => {
    void promptDialog({ title: 'Add link', autofocus: false })
    await flushPromises()
    expect(document.activeElement).not.toBe(field())
  })

  it('answers on Enter and ignores an empty field', async () => {
    const reply = promptDialog({ title: 'New CSS snippet' })
    await flushPromises()
    type('   ')
    enter()
    press('Create')
    expect(modal()).not.toBeNull()
    type('sample')
    enter()
    await expect(reply).resolves.toBe('sample')
  })

  it('is null when cancelled', async () => {
    const reply = promptDialog({ title: 'New script' })
    await flushPromises()
    type('sample')
    press('Cancel')
    await expect(reply).resolves.toBeNull()
  })

  it('keeps itself open with the validation message, and answers what validate returned', async () => {
    const reply = promptDialog({
      title: 'Add link',
      placeholder: 'Web address',
      submitText: 'Create',
      modalClass: 'abele-sample-prompt',
      validate: (value) => {
        if (!value.startsWith('https://')) throw new Error('Use an HTTPS address')
        return `${value}/`
      },
    })
    await flushPromises()
    expect(modal()?.classList.contains('abele-sample-prompt')).toBe(true)
    expect(field().getAttribute('aria-label')).toBe('Web address')
    type('sample')
    press('Create')
    await flushPromises()
    expect(document.querySelector('.modal p.mod-warning')?.textContent).toBe(
      'Error: Use an HTTPS address'
    )
    type('https://example.com')
    press('Create')
    await expect(reply).resolves.toBe('https://example.com/')
  })
})

describe('choiceDialog', () => {
  it('shows the quote, the message and the answers in order, and answers the value pressed', async () => {
    const reply = choiceDialog({
      title: 'Remove this sample?',
      quote: 'Sample words',
      message: ['First paragraph.', 'Second paragraph.'],
      choices: [
        { value: 'keep', text: 'Keep', cta: true },
        { value: 'delete', text: 'Delete too', warning: true },
        { value: null, text: 'Cancel' },
      ],
    })
    await flushPromises()
    expect(document.querySelector('.abele-choice__quote')?.textContent).toBe('“Sample words”')
    expect(
      [...document.querySelectorAll('.abele-choice__message')].map((p) => p.textContent)
    ).toEqual(['First paragraph.', 'Second paragraph.'])
    expect(buttons()).toEqual(['Keep', 'Delete too', 'Cancel'])
    // Its Cancel is the one way out, as for every form with one in its row.
    expect(modal()?.classList.contains('abele-modal_footer-dismiss')).toBe(true)
    expect(document.querySelector('.modal .mod-cta')?.textContent?.trim()).toBe('Keep')
    expect(document.querySelector('.modal .mod-warning')?.textContent?.trim()).toBe('Delete too')
    press('Delete too')
    await expect(reply).resolves.toBe('delete')
  })

  it('keeps the header close button when no choice is a Cancel', async () => {
    const reply = choiceDialog({
      title: 'Allow network?',
      choices: [
        { value: 'no', text: 'Keep offline' },
        { value: 'yes', text: 'Allow', cta: true },
      ],
    })
    await flushPromises()
    expect(modal()?.classList.contains('abele-modal_footer-dismiss')).toBe(false)
    press('Allow')
    await expect(reply).resolves.toBe('yes')
  })

  it('answers an item from the body list, and null for Cancel', async () => {
    const reply = choiceDialog({
      title: 'Choose a source',
      message: 'Pick one.',
      items: [
        { value: 'a.md', text: 'a.md' },
        { value: 'b.md', text: 'b.md' },
      ],
      choices: [{ value: null, text: 'Cancel' }],
    })
    await flushPromises()
    expect(
      [...document.querySelectorAll('.abele-choice__item')].map((b) => b.textContent?.trim())
    ).toEqual(['a.md', 'b.md'])
    press('b.md')
    await expect(reply).resolves.toBe('b.md')
    const none = choiceDialog({ title: 'Again', choices: [{ value: null, text: 'Cancel' }] })
    await flushPromises()
    press('Cancel')
    await expect(none).resolves.toBeNull()
  })
})
