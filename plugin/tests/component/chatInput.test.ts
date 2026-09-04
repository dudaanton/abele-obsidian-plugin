/**
 * The sidebar's composer, and the one button it grows for a comment.
 *
 * A comment is a place in a note as much as it is a chat: half of what people write into one
 * is a reminder or a second thought rather than a question, and running a model over that is a
 * wait and a cost for an answer nobody wanted. The margin's composer has had that button all
 * along; now that a comment is read in this composer wherever no margin fits, so has this one —
 * and only here, because an ordinary chat has nothing to keep a note against.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AiChatInput from '@/components/AiChatInput.vue'
import Icon from '@/components/obsidian/Icon.vue'
import VoiceRecorder from '@/components/VoiceRecorder.vue'
import { useVault } from '../helpers/testEnv'

useVault([])

const mountInput = (props: { canNote?: boolean; noteBlocked?: boolean } = {}) =>
  mount(AiChatInput, {
    props: {
      isStreaming: false,
      isBusy: false,
      canContinue: false,
      tokenDisplay: '',
      scopeLabel: '',
      ...props,
    },
    attachTo: document.body,
  })

/** By what it is, not by where it sits: a second action must not renumber the first. */
const button = (view: ReturnType<typeof mountInput>, icon: string) =>
  view.findAllComponents(Icon).find((i) => i.props('icon') === icon)

describe('keeping a note in the sidebar', () => {
  it('is not offered in an ordinary chat, which has no note to keep one against', () => {
    expect(button(mountInput(), 'sticky-note')).toBeUndefined()
  })

  it('says what it does, in the same words the margin uses', () => {
    const view = mountInput({ canNote: true })

    expect(button(view, 'sticky-note')!.props('tooltip')).toBe(
      'Save as note, without asking the agent (Alt+Enter)'
    )
  })

  it('hands the words over and empties itself, without sending anything', async () => {
    const view = mountInput({ canNote: true })
    await view.find('textarea').setValue('Come back to this paragraph')

    await button(view, 'sticky-note')!.trigger('click')

    expect(view.emitted('note')).toEqual([['Come back to this paragraph']])
    expect(view.emitted('send')).toBeUndefined()
    expect((view.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  })

  it('takes Alt+Enter, which is a message without the model', async () => {
    const view = mountInput({ canNote: true })
    await view.find('textarea').setValue('A thought, not a question')

    await view.find('textarea').trigger('keydown', { key: 'Enter', altKey: true })

    expect(view.emitted('note')).toEqual([['A thought, not a question']])
    expect(view.emitted('send')).toBeUndefined()
  })

  it('leaves Alt+Enter alone in a chat that cannot keep notes', async () => {
    const view = mountInput()
    await view.find('textarea').setValue('A thought')

    await view.find('textarea').trigger('keydown', { key: 'Enter', altKey: true })

    expect(view.emitted('note')).toBeUndefined()
  })

  it('keeps nothing when there is nothing but whitespace', async () => {
    const view = mountInput({ canNote: true })
    await view.find('textarea').setValue('   ')

    await button(view, 'sticky-note')!.trigger('click')

    expect(view.emitted('note')).toBeUndefined()
  })

  /**
   * A note goes into the same history the running turn is being answered from, and one put in
   * between a `tool_use` and its result is a conversation the model refuses afterwards.
   * `ChatSession.addUserNote` says no as well — this is so the button says so first.
   */
  it('goes dark while the agent is holding a turn open, and says why', async () => {
    const view = mountInput({ canNote: true, noteBlocked: true })
    await view.find('textarea').setValue('A thought')

    expect(button(view, 'sticky-note')!.props('disabled')).toBe(true)
    expect(button(view, 'sticky-note')!.props('tooltip')).toContain('before keeping a note')

    await button(view, 'sticky-note')!.trigger('click')
    await view.find('textarea').trigger('keydown', { key: 'Enter', altKey: true })

    expect(view.emitted('note')).toBeUndefined()
  })
})

describe('dictating into the sidebar', () => {
  const recorder = (view: ReturnType<typeof mountInput>) => view.findComponent(VoiceRecorder)

  it('offers a dictated note only where a note can be kept at all', async () => {
    const view = mountInput({ canNote: true })
    await button(view, 'mic')!.trigger('click')

    expect(recorder(view).props('canNote')).toBe(true)
    expect(recorder(view).props('canSend')).toBe(true)
  })

  it('offers no dictated note in an ordinary chat', async () => {
    const view = mountInput()
    await button(view, 'mic')!.trigger('click')

    expect(recorder(view).props('canNote')).toBe(false)
  })

  it('offers none either while the agent is holding a turn open', async () => {
    const view = mountInput({ canNote: true, noteBlocked: true })
    await button(view, 'mic')!.trigger('click')

    expect(recorder(view).props('canNote')).toBe(false)
    // Sending still works: a question dictated now waits its turn instead of being lost.
    expect(recorder(view).props('canSend')).toBe(true)
  })

  it('keeps what was dictated as a note, without asking anybody', async () => {
    const view = mountInput({ canNote: true })
    await button(view, 'mic')!.trigger('click')

    await recorder(view).vm.$emit('note', 'вернуться к этому абзацу')

    expect(view.emitted('note')).toEqual([['вернуться к этому абзацу']])
    expect(view.emitted('send')).toBeUndefined()
  })
})
