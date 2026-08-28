/**
 * What a script can put in front of the person running it.
 *
 * The modal was built to ask questions, and a script with something to *say* had only a
 * notice — truncated at 500 characters, gone after ten seconds, and impossible to select
 * text out of. A `markdown` field is the answer: a block that is read rather than filled in,
 * and a form made only of those is a document, which the modal has to show as one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Modal } from 'obsidian'
import ScriptFormModal from '@/components/ScriptFormModal.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import type { FormField } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

let resolved: Record<string, string> | null | undefined

function openWith(fields: FormField[]) {
  resolved = undefined
  return mount(ScriptFormModal, {
    props: {
      fields,
      resolve: (result: Record<string, string> | null) => {
        resolved = result
      },
    },
    attachTo: document.body,
  })
}

/**
 * The modal teleports its content into the container Obsidian owns, so what it rendered is in
 * the document rather than under the wrapper. Components are still found through the wrapper;
 * elements are found here.
 */
const inDocument = <T extends Element>(selector: string): T | null =>
  document.querySelector<T>(selector)

const buttonSaying = (text: string): HTMLButtonElement | undefined =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)

const submitForm = () => inDocument<HTMLFormElement>('form')?.requestSubmit()

const question: FormField = { name: 'query', label: 'Query', type: 'text' }
const prose: FormField = {
  name: 'summary',
  label: 'What was found',
  type: 'markdown',
  text: '# Heading\n\nSome **bold** prose.',
}

beforeEach(() => {
  useVault([])
})

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('a markdown field', () => {
  it('is rendered as markdown rather than shown as text', () => {
    const wrapper = openWith([prose])

    expect(wrapper.findComponent(Markdown).props('text')).toBe(prose.text)
  })

  it('asks for nothing — no input stands in for it', () => {
    openWith([prose])

    expect(inDocument('.abele-script-form__input')).toBeNull()
    expect(inDocument('textarea')).toBeNull()
    expect(inDocument('select')).toBeNull()
  })

  it('contributes no value to what the form returns', () => {
    openWith([question, prose])

    submitForm()

    expect(resolved).toEqual({ query: '' })
  })

  it('sits beside the questions when there are any', () => {
    const wrapper = openWith([question, prose])

    expect(wrapper.findComponent(Markdown).exists()).toBe(true)
    expect(inDocument('.abele-script-form__input')).not.toBeNull()
  })

  it('falls back to the default when no text is given, so neither name is a trap', () => {
    const wrapper = openWith([{ name: 'note', label: '', type: 'markdown', default: 'Read me.' }])

    expect(wrapper.findComponent(Markdown).props('text')).toBe('Read me.')
  })
})

describe('a form that asks nothing', () => {
  it('offers no way to run it, because there is nothing to run', () => {
    openWith([prose])

    expect(buttonSaying('Run')).toBeUndefined()
  })

  it('offers to close rather than to cancel', () => {
    openWith([prose])

    expect(buttonSaying('Close')).toBeDefined()
    expect(buttonSaying('Cancel')).toBeUndefined()
  })

  it('closing it answers nothing, as cancelling a form does', () => {
    openWith([prose])

    buttonSaying('Close')?.click()

    expect(resolved).toBeNull()
  })
})

describe('a form that does ask something', () => {
  it('still runs and cancels as it did', () => {
    openWith([question])

    expect(buttonSaying('Run')).toBeDefined()
    expect(buttonSaying('Cancel')).toBeDefined()

    submitForm()
    expect(resolved).toEqual({ query: '' })
  })
})

/** The modal's own heading, as it was set on the Obsidian modal being opened. */
function headingWhenOpening(fields: FormField[]): string | undefined {
  const setTitle = vi.spyOn(Modal.prototype, 'setTitle')
  openWith(fields)
  return setTitle.mock.calls.at(-1)?.[0]
}

describe('the heading of a form with nothing to answer', () => {
  it('is the label of what it shows, put where a window keeps its title', () => {
    expect(headingWhenOpening([prose])).toBe('What was found')
  })

  it('is not repeated above the text it names', () => {
    openWith([prose])

    expect(inDocument('.abele-script-form__label')).toBeNull()
  })

  it('falls back to naming the thing when the script gave no title', () => {
    expect(
      headingWhenOpening([{ name: 'note', label: '', type: 'markdown', text: 'Read me.' }])
    ).toBe('Script')
  })
})

describe('the heading of a form that does ask something', () => {
  it('still says what is being asked for', () => {
    expect(headingWhenOpening([question, prose])).toBe('Script Parameters')
  })

  it('leaves the label of a markdown block beside the questions where it is', () => {
    openWith([question, prose])

    const labels = [...document.querySelectorAll('.abele-script-form__label')].map((l) =>
      l.textContent?.trim()
    )
    expect(labels).toContain('What was found')
  })
})
