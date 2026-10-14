/**
 * Replying to places of the agent's words, in the composer: each place is a chip in the text
 * where the cursor was, the person's own words between them, and what is sent is the words with
 * where each place stood — never the agent's words pasted in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import AiChatInput from '@/components/AiChatInput.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatReplyTo } from '@/ai/types'
import { replyToken } from '@/ai/replyLinks'
import { replyChips } from '@/editor/replyChips'
import { deleteCharBackward } from '@codemirror/commands'
import { useVault } from '../helpers/testEnv'
import { fakeNoteEditors, resetFakeNoteEditors } from '../helpers/fakeNoteEditor'

vi.mock('@/editor/embeddedEditor', () => import('../helpers/fakeNoteEditor'))

const mounted: Array<{ unmount(): void }> = []

beforeEach(() => {
  useVault([])
  resetFakeNoteEditors()
  document.body.replaceChildren()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
})

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount()
  vi.restoreAllMocks()
})

function composer(extra: Record<string, unknown> = {}) {
  const wrapper = mount(AiChatInput, {
    attachTo: document.body,
    props: {
      isStreaming: false,
      isBusy: false,
      canContinue: false,
      tokenDisplay: '',
      scopeLabel: '',
      ...extra,
    },
  })
  mounted.push(wrapper)
  return wrapper
}

const editor = () => fakeNoteEditors[fakeNoteEditors.length - 1]
type Quoting = { quote(to: ChatReplyTo): void }

const lamp = { messageId: 'a1', quote: 'plates with air', start: 4 }
const wait = { messageId: 'a2', quote: 'every thirty minutes' }

describe('places in the composer', () => {
  it('puts each place in the text where the cursor is, the words between them, and sends where each stood', async () => {
    const wrapper = composer()
    const field = wrapper.vm as unknown as Quoting
    editor().type('About')
    field.quote(lamp)
    await nextTick()
    expect(editor().value).toBe(`About ${replyToken(lamp)} `)
    editor().type(`${editor().value}how many? And`)
    editor().cursor = undefined
    field.quote(wait)
    // The same place again is the one already there.
    field.quote({ ...lamp })
    editor().type(`${editor().value}in winter too?`)
    expect(editor().press('Shift-Enter')).toBe(true)
    expect(wrapper.emitted('send')).toEqual([
      [
        'About  how many? And  in winter too?',
        [],
        [
          { ...lamp, at: 6 },
          { ...wait, at: 21 },
        ],
      ],
    ])
  })

  it('puts a place where the cursor stands in the middle of the words', async () => {
    const wrapper = composer()
    editor().type('First. Last.')
    editor().cursor = 7
    ;(wrapper.vm as unknown as Quoting).quote(wait)
    await nextTick()
    expect(editor().value).toBe(`First. ${replyToken(wait)} Last.`)
  })

  it('sends nothing for a place taken out of the text before sending', async () => {
    const wrapper = composer()
    ;(wrapper.vm as unknown as Quoting).quote(lamp)
    editor().type('Only my words.')
    editor().press('Shift-Enter')
    expect(wrapper.emitted('send')).toEqual([['Only my words.', []]])
  })

  it('sends a message that is only a place', async () => {
    const wrapper = composer()
    ;(wrapper.vm as unknown as Quoting).quote(lamp)
    editor().press('Shift-Enter')
    expect(wrapper.emitted('send')).toEqual([['', [], [{ ...lamp, at: 0 }]]])
  })
})

describe('places in a plain text box', () => {
  it('stands a numbered marker in the text, says what each number is, and sends the places', async () => {
    const wrapper = composer({ textOnly: true })
    const box = wrapper.get('textarea')
    await box.setValue('About')
    ;(box.element as HTMLTextAreaElement).setSelectionRange(5, 5)
    const field = wrapper.vm as unknown as Quoting
    field.quote(lamp)
    await nextTick()
    expect((box.element as HTMLTextAreaElement).value).toBe('About [↩1] ')
    await box.setValue('About [↩1] how many? ')
    ;(box.element as HTMLTextAreaElement).setSelectionRange(21, 21)
    field.quote(wait)
    await nextTick()
    const legend = wrapper.findAll('.abele-chat-input__replies .abele-reply-chip')
    expect(legend.map((c) => c.text())).toEqual(['1plates with air', '2every thirty minutes'])
    await box.setValue(`${(box.element as HTMLTextAreaElement).value}winter?`)
    await box.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('send')).toEqual([
      [
        'About  how many?  winter?',
        [],
        [
          { ...lamp, at: 6 },
          { ...wait, at: 17 },
        ],
      ],
    ])
  })

  it('takes a place out with its cross in the row, marker and all', async () => {
    const wrapper = composer({ textOnly: true })
    ;(wrapper.vm as unknown as Quoting).quote(lamp)
    await nextTick()
    wrapper
      .get('.abele-reply-chip__remove')
      .element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await nextTick()
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe(' ')
    expect(wrapper.find('.abele-chat-input__replies').exists()).toBe(false)
  })
})

describe('the chips in the note editor', () => {
  function view(doc: string, open = vi.fn()) {
    const parent = document.body.appendChild(document.createElement('div'))
    return new EditorView({
      parent,
      state: EditorState.create({ doc, extensions: [replyChips(open)] }),
    })
  }

  it('draws each place as a chip, numbered once there are several', () => {
    const v = view(`a ${replyToken(lamp)} b ${replyToken(wait)} c ${replyToken(lamp)}`)
    const chips = Array.from(v.dom.querySelectorAll('.abele-reply-chip'))
    expect(chips.map((c) => c.querySelector('.abele-reply-chip__number')?.textContent)).toEqual([
      '1',
      '2',
      '1',
    ])
    expect(chips[1].querySelector('.abele-reply-chip__words')?.textContent).toBe(
      'every thirty minutes'
    )
    v.destroy()
  })

  it('draws a single place without a number, and goes to it when pressed', () => {
    const open = vi.fn()
    const v = view(`a ${replyToken(lamp)} b`, open)
    const chip = v.dom.querySelector<HTMLElement>('.abele-reply-chip')!
    expect(chip.querySelector('.abele-reply-chip__number')).toBeNull()
    chip.click()
    expect(open).toHaveBeenCalledWith(lamp)
    v.destroy()
  })

  it('takes a place out of the text with its cross', () => {
    const v = view(`a ${replyToken(lamp)} b`)
    v.dom
      .querySelector('.abele-reply-chip__remove')!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    expect(v.state.doc.toString()).toBe('a  b')
    v.destroy()
  })

  it('deletes a place as one character', () => {
    const token = replyToken(lamp)
    const v = view(`a${token}b`)
    v.dispatch({ selection: { anchor: 1 + token.length } })
    deleteCharBackward(v)
    expect(v.state.doc.toString()).toBe('ab')
    v.destroy()
  })
})
