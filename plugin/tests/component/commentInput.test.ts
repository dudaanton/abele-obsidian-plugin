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
import VoiceRecorder from '@/components/VoiceRecorder.vue'

const mountInput = (
  props: {
    busy?: boolean
    disabled?: boolean
    focus?: boolean
    host?: 'margin' | 'sheet'
  } = {}
) => mount(CommentInput, { props: { busy: false, ...props }, attachTo: document.body })

/** By what it is, not by where it sits: a second action must not renumber the first. */
const button = (view: ReturnType<typeof mountInput>, icon: string) => {
  const found = view.findAllComponents(Icon).find((i) => i.props('icon') === icon)
  if (!found) throw new Error(`no button carrying the icon "${icon}"`)
  return found
}

describe('the comment input', () => {
  /**
   * The margin's composer is small on purpose — a 300 px sidenote beside the text — and a
   * phone got the same one: a field set below 16 px, which iOS answers by zooming the whole
   * note the moment it is focused. The sheet host is what says "this is the screen, not a
   * margin", and the stylesheet sizes the field and the send button from it.
   */
  it('is drawn at reading size when it is the whole screen', () => {
    const view = mountInput({ host: 'sheet' })

    expect(view.classes()).toContain('abele-comment-input_sheet')
  })

  it('keeps the compact composer the margin needs by default', () => {
    expect(mountInput().classes()).not.toContain('abele-comment-input_sheet')
  })

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

    const send = button(view, 'square')

    await send.trigger('click')

    expect(view.emitted('abort')).toHaveLength(1)
    expect(view.emitted('send')).toBeUndefined()
  })

  it('refuses everything while the comment is still being read', async () => {
    const view = mountInput({ disabled: true })

    expect(view.findComponent(Input).props('disabled')).toBe(true)
    expect(button(view, 'send-horizontal').props('disabled')).toBe(true)

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

/**
 * Half of what people write into a comment is not a question.
 *
 * A comment is a place in a note as much as it is a chat — a reminder, a second thought,
 * something to come back to — and running a model over that is a wait and a cost for an answer
 * nobody wanted. The second button keeps the words in the conversation and starts nothing;
 * whatever is asked afterwards carries them along, which is the whole reason to write them
 * here rather than in the note.
 */
describe('keeping a note instead of asking', () => {
  it('offers a second button that says what it does', () => {
    const view = mountInput()

    expect(button(view, 'sticky-note').props('tooltip')).toBe(
      'Save as note, without asking the agent (Alt+Enter)'
    )
  })

  it('hands the words over and empties itself', async () => {
    const view = mountInput()
    await view.find('textarea').setValue('Come back to this paragraph')

    await button(view, 'sticky-note').trigger('click')

    expect(view.emitted('note')).toEqual([['Come back to this paragraph']])
    expect(view.emitted('send')).toBeUndefined()
    expect(view.findComponent(Input).props('modelValue')).toBe('')
  })

  it('takes Alt+Enter, which is Enter without the model', async () => {
    const view = mountInput()
    await view.find('textarea').setValue('A thought, not a question')

    await view.find('textarea').trigger('keydown', { key: 'Enter', altKey: true })

    expect(view.emitted('note')).toEqual([['A thought, not a question']])
    expect(view.emitted('send')).toBeUndefined()
  })

  it('keeps nothing when there is nothing but whitespace', async () => {
    const view = mountInput()
    await view.find('textarea').setValue('   ')

    await view.find('textarea').trigger('keydown', { key: 'Enter', altKey: true })

    expect(view.emitted('note')).toBeUndefined()
  })

  /** A note goes into the same history the running turn is being answered from. */
  it('waits its turn while the agent is working', async () => {
    const view = mountInput({ busy: true })
    await view.find('textarea').setValue('A thought')

    expect(button(view, 'sticky-note').props('disabled')).toBe(true)

    await button(view, 'sticky-note').trigger('click')

    expect(view.emitted('note')).toBeUndefined()
  })
})

/**
 * Dictation, which the sidebar has had all along.
 *
 * The same panel, mounted the same way `AiChatInput` mounts it: the microphone opens it, it
 * starts listening on its own, and what comes back goes into the field, or straight out as a
 * question, or straight out as a note. Nothing about recording or transcribing is reimplemented
 * here, which is why none of it is tested here either.
 */
describe('dictating into a comment', () => {
  const recorder = (view: ReturnType<typeof mountInput>) => view.findComponent(VoiceRecorder)

  it('opens on the microphone and starts listening at once', async () => {
    const view = mountInput()
    expect(recorder(view).exists()).toBe(false)

    await button(view, 'mic').trigger('click')

    expect(recorder(view).props('autoStart')).toBe(true)
    // A comment takes a question or a note, so the panel offers both endings.
    expect(recorder(view).props('canSend')).toBe(true)
    expect(recorder(view).props('canNote')).toBe(true)
  })

  it('puts the words in the field, to be read before they are sent', async () => {
    const view = mountInput()
    await button(view, 'mic').trigger('click')

    await recorder(view).vm.$emit('text', 'что это значит')

    expect(view.findComponent(Input).props('modelValue')).toBe('что это значит')
    expect(view.emitted('send')).toBeUndefined()
  })

  it('sends what was dictated, when that is what was pressed', async () => {
    const view = mountInput()
    await button(view, 'mic').trigger('click')

    await recorder(view).vm.$emit('send', 'что это значит')

    expect(view.emitted('send')).toEqual([['что это значит']])
  })

  it('keeps what was dictated as a note, without asking anybody', async () => {
    const view = mountInput()
    await button(view, 'mic').trigger('click')

    await recorder(view).vm.$emit('note', 'вернуться к этому абзацу')

    expect(view.emitted('note')).toEqual([['вернуться к этому абзацу']])
    expect(view.emitted('send')).toBeUndefined()
  })

  it('closes when the panel says it is done', async () => {
    const view = mountInput()
    await button(view, 'mic').trigger('click')

    await recorder(view).vm.$emit('close')

    expect(recorder(view).exists()).toBe(false)
  })
})
