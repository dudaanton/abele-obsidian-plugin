/**
 * The one-line composer in the margin.
 *
 * A sidenote is 180–300 px wide and stacked against its neighbours, so the field starts at one
 * line and stops at five: past that it scrolls rather than pushing the next card down the
 * page. Enter sends because a comment is a question, not a document; Shift+Enter is how you
 * get a second line.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import CommentInput from '@/components/CommentInput.vue'
import Input from '@/components/obsidian/Input.vue'
import Icon from '@/components/obsidian/Icon.vue'

const mountInput = (props: { busy?: boolean; disabled?: boolean; focus?: boolean } = {}) =>
  mount(CommentInput, { props: { busy: false, ...props }, attachTo: document.body })

describe('the comment input', () => {
  it('invites a question', () => {
    const view = mountInput()

    expect(view.findComponent(Input).props('placeholder')).toBe('Ask about this…')
  })

  it('starts at one line and grows with the text', async () => {
    const view = mountInput()

    expect(view.findComponent(Input).props('rows')).toBe(1)

    await view.find('textarea').setValue('one\ntwo\nthree')

    expect(view.findComponent(Input).props('rows')).toBe(3)
  })

  it('stops growing at five lines', async () => {
    const view = mountInput()

    await view.find('textarea').setValue('1\n2\n3\n4\n5\n6\n7')

    expect(view.findComponent(Input).props('rows')).toBe(5)
  })

  it('sends on Enter and empties itself', async () => {
    const view = mountInput()
    await view.find('textarea').setValue('What does this mean?')

    await view.find('textarea').trigger('keydown', { key: 'Enter' })

    expect(view.emitted('send')).toEqual([['What does this mean?']])
    expect(view.findComponent(Input).props('modelValue')).toBe('')
  })

  it('takes a newline on Shift+Enter and sends nothing', async () => {
    const view = mountInput()
    await view.find('textarea').setValue('First line')

    await view.find('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(view.emitted('send')).toBeUndefined()
  })

  it('sends nothing when there is nothing but whitespace', async () => {
    const view = mountInput()
    await view.find('textarea').setValue('   ')

    await view.find('textarea').trigger('keydown', { key: 'Enter' })

    expect(view.emitted('send')).toBeUndefined()
  })

  it('becomes a stop button while the agent is working', async () => {
    const view = mountInput({ busy: true })

    const send = view.findComponent(Icon)
    expect(send.props('icon')).toBe('square')

    await send.trigger('click')

    expect(view.emitted('abort')).toHaveLength(1)
    expect(view.emitted('send')).toBeUndefined()
  })

  it('refuses everything while the comment is still being read', async () => {
    const view = mountInput({ disabled: true })

    expect(view.findComponent(Input).props('disabled')).toBe(true)
    expect(view.findComponent(Icon).props('disabled')).toBe(true)

    await view.find('textarea').setValue('Anything')
    await view.find('textarea').trigger('keydown', { key: 'Enter' })

    expect(view.emitted('send')).toBeUndefined()
  })

  it('grows for a question that wraps without a newline', async () => {
    // A sidenote is 300 px at its widest, so most questions wrap before they reach a newline.
    // Counting newlines alone leaves a three-line question showing one line of itself.
    const view = mountInput()
    const field = view.find('textarea').element
    Object.defineProperty(field, 'clientHeight', { value: 20, configurable: true })
    Object.defineProperty(field, 'scrollHeight', { value: 60, configurable: true })

    await view.find('textarea').setValue('one sentence, long enough to wrap three times over')

    expect(view.findComponent(Input).props('rows')).toBe(3)
  })

  it('stops at five rows however far the text wraps', async () => {
    const view = mountInput()
    const field = view.find('textarea').element
    Object.defineProperty(field, 'clientHeight', { value: 20, configurable: true })
    Object.defineProperty(field, 'scrollHeight', { value: 400, configurable: true })

    await view.find('textarea').setValue('a very long sentence indeed')

    expect(view.findComponent(Input).props('rows')).toBe(5)
  })

  it('puts the caret where the question goes when the card asks for it', () => {
    // Creating a comment opens the card expanded and expects to be typed into straight away.
    const view = mountInput({ focus: true })

    expect(document.activeElement).toBe(view.find('textarea').element)
  })

  it('leaves the caret in the note when an existing comment is merely expanded', () => {
    const view = mountInput()

    expect(document.activeElement).not.toBe(view.find('textarea').element)
  })
})
