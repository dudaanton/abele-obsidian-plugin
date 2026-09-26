/**
 * The kit's note picker, and the two places scripts put it: a `form()` field and a view node.
 *
 * Typing narrows a list of the notes the filter lets through; taking one puts it above the field
 * as a pill; a field taking one note swaps it, a field taking several adds to them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { AbstractInputSuggest } from 'obsidian'
import NotePicker from '@/components/obsidian/NotePicker.vue'
import ScriptFormModal from '@/components/ScriptFormModal.vue'
import type { NotePick } from '@/helpers/noteFilter'
import type { FormField } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

vi.mock('@/editor/embeddedEditor', () => import('../helpers/fakeNoteEditor'))

type Suggest = AbstractInputSuggest<NotePick> & {
  suggestionsNow(): NotePick[]
  selectSuggestion(pick: NotePick): void
}

const suggesterOf = (root: ParentNode): Suggest => {
  const input = root.querySelector('input') as HTMLInputElement
  const attached = (
    AbstractInputSuggest as unknown as { attachedTo: WeakMap<HTMLInputElement, Suggest> }
  ).attachedTo
  return attached.get(input) as Suggest
}

/** Types into the field and takes the first line the list offers. */
function take(root: ParentNode, query: string) {
  const suggest = suggesterOf(root)
  ;(root.querySelector('input') as HTMLInputElement).value = query
  const first = suggest.suggestionsNow()[0]
  suggest.selectSuggestion(first)
}

const pills = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>('.abele-note-picker__pill')].map((p) => p.dataset.path)

const wallets = { property: 'type', value: 'account' }
let wrapper: VueWrapper | null = null

beforeEach(() => {
  useVault([
    { path: 'Finance/Cash.md', frontmatter: { type: 'account', title: 'Wallet' } },
    { path: 'Finance/Card.md', frontmatter: { type: 'account' } },
    { path: 'Finance/Coffee.md', frontmatter: { type: 'transaction' } },
  ])
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.replaceChildren()
})

describe('NotePicker', () => {
  function mountPicker(props: Record<string, unknown>) {
    wrapper = mount(NotePicker, {
      props: {
        modelValue: [],
        filter: wallets,
        'onUpdate:modelValue': (v: string[]) => wrapper?.setProps({ modelValue: v }),
        ...props,
      },
      attachTo: document.body,
    })
    return wrapper
  }

  it('offers only the notes the filter lets through', () => {
    const w = mountPicker({})
    const offered = suggesterOf(w.element).suggestionsNow()
    expect(offered.map((p) => ('file' in p ? p.file.path : ''))).toEqual([
      'Finance/Card.md',
      'Finance/Cash.md',
    ])
  })

  it('shows the note it was given as a pill with its title and folder', () => {
    const w = mountPicker({ modelValue: ['Finance/Cash.md'] })
    expect(pills(w.element)).toEqual(['Finance/Cash.md'])
    expect(w.find('.abele-note-picker__title').text()).toBe('Wallet')
    expect(w.find('.abele-note-picker__folder').text()).toBe('Finance')
  })

  it('swaps the note when it takes one', async () => {
    const w = mountPicker({ modelValue: ['Finance/Cash.md'] })
    take(w.element, 'card')
    await flushPromises()
    expect(w.emitted('update:model-value')?.at(-1)).toEqual([['Finance/Card.md']])
    expect(pills(w.element)).toEqual(['Finance/Card.md'])
  })

  it('adds to what it has when it takes several, never offering one twice', async () => {
    const w = mountPicker({ multiple: true, modelValue: ['Finance/Cash.md'] })
    const offered = suggesterOf(w.element).suggestionsNow()
    expect(offered).toHaveLength(1)
    take(w.element, '')
    await flushPromises()
    expect(pills(w.element)).toEqual(['Finance/Cash.md', 'Finance/Card.md'])
  })

  it('takes a note out when its cross is pressed', async () => {
    const w = mountPicker({ multiple: true, modelValue: ['Finance/Cash.md', 'Finance/Card.md'] })
    await w.findAll('.abele-note-picker__remove')[0].trigger('click')
    expect(w.emitted('update:model-value')?.at(-1)).toEqual([['Finance/Card.md']])
  })

  it('makes the note it was asked to create, inside the filter', async () => {
    const w = mountPicker({ create: true, filter: { folder: 'Finance', ...wallets } })
    take(w.element, 'Savings')
    await flushPromises()
    expect(w.emitted('update:model-value')?.at(-1)).toEqual([['Finance/Savings.md']])
  })
})

describe('a note-picker field in a form', () => {
  let resolved: Record<string, string> | null | undefined

  function openWith(fields: FormField[]) {
    resolved = undefined
    wrapper = mount(ScriptFormModal, {
      props: { fields, resolve: (r: Record<string, string> | null) => (resolved = r) },
      attachTo: document.body,
    })
  }
  const submit = () => document.querySelector<HTMLFormElement>('form')?.requestSubmit()

  it('answers one path, starting from its default given as a link', () => {
    openWith([
      {
        name: 'wallet',
        label: 'Wallet',
        type: 'note-picker',
        filter: wallets,
        default: '[[Cash]]',
      },
    ])
    expect(pills(document)).toEqual(['Finance/Cash.md'])
    submit()
    expect(resolved).toEqual({ wallet: 'Finance/Cash.md' })
  })

  it('answers a list where it takes several, empty when nothing was chosen', async () => {
    openWith([{ name: 'w', label: 'W', type: 'note-picker', filter: wallets, multiple: true }])
    submit()
    expect(resolved).toEqual({ w: '[]' })
  })

  it('answers what the person took', async () => {
    openWith([{ name: 'w', label: 'W', type: 'note-picker', filter: wallets, multiple: true }])
    take(document.querySelector('.abele-note-picker') as HTMLElement, 'wallet')
    await flushPromises()
    submit()
    expect(resolved).toEqual({ w: '["Finance/Cash.md"]' })
  })
})
