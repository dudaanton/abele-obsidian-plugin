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
  it('puts each place on a line of its own where the cursor is, the words around them, and sends where each stood', async () => {
    const wrapper = composer()
    const field = wrapper.vm as unknown as Quoting
    editor().type('About')
    field.quote(lamp)
    await nextTick()
    expect(editor().value).toBe(`About\n${replyToken(lamp)}\n`)
    editor().type(`${editor().value}How many?`)
    editor().cursor = undefined
    field.quote(wait)
    // The same place again is the one already there.
    field.quote({ ...lamp })
    editor().type(`${editor().value}In winter too?`)
    expect(editor().press('Shift-Enter')).toBe(true)
    expect(wrapper.emitted('send')).toEqual([
      [
        'About\n\nHow many?\n\nIn winter too?',
        [],
        [
          { ...lamp, at: 6 },
          { ...wait, at: 17 },
        ],
      ],
    ])
  })

  it('puts a place on the empty line the cursor stands on', async () => {
    const wrapper = composer()
    editor().type('First.\n\nLast.')
    editor().cursor = 7
    ;(wrapper.vm as unknown as Quoting).quote(wait)
    await nextTick()
    expect(editor().value).toBe(`First.\n${replyToken(wait)}\nLast.`)
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
  it('stands a numbered marker on its line, says what each number is, and sends the places', async () => {
    const wrapper = composer({ textOnly: true })
    const box = wrapper.get('textarea')
    const area = box.element as HTMLTextAreaElement
    await box.setValue('About')
    area.setSelectionRange(5, 5)
    const field = wrapper.vm as unknown as Quoting
    field.quote(lamp)
    await nextTick()
    expect(area.value).toBe('About\n[↩1]\n')
    await box.setValue(`${area.value}How many?`)
    area.setSelectionRange(area.value.length, area.value.length)
    field.quote(wait)
    await nextTick()
    const legend = wrapper.findAll('.abele-chat-input__replies .abele-chat-input__reply')
    expect(legend.map((c) => c.text())).toEqual(['[↩1]plates with air', '[↩2]every thirty minutes'])
    await box.setValue(`${area.value}Winter?`)
    await box.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(wrapper.emitted('send')).toEqual([
      [
        'About\n\nHow many?\n\nWinter?',
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
    await wrapper.get('.abele-chat-reply-card__remove').trigger('click')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('\n')
    expect(wrapper.find('.abele-chat-input__replies').exists()).toBe(false)
  })
})

describe('the cards in the note editor', () => {
  function view(doc: string, open = vi.fn()) {
    const parent = document.body.appendChild(document.createElement('div'))
    return new EditorView({
      parent,
      state: EditorState.create({ doc, extensions: [replyChips(open)] }),
    })
  }

  it('draws each place as its card in place, the words around it showing', () => {
    const v = view(`${replyToken(lamp)}\nHow many?\n${replyToken(wait)}\nOk`)
    const cards = Array.from(v.dom.querySelectorAll('.abele-chat-reply-card'))
    expect(cards.map((c) => c.textContent?.trim())).toEqual([
      'plates with air',
      'every thirty minutes',
    ])
    expect(v.contentDOM.textContent).toContain('How many?')
    expect(v.contentDOM.textContent).not.toContain('')
    v.destroy()
  })

  it('goes to the place a card replies to when it is pressed', () => {
    const open = vi.fn()
    const v = view(`${replyToken(lamp)}\n`, open)
    v.dom.querySelector<HTMLElement>('.abele-chat-reply-card')!.click()
    expect(open).toHaveBeenCalledWith(lamp)
    v.destroy()
  })

  it('takes a card out with its line, the words around it left', () => {
    const v = view(`Before\n${replyToken(lamp)}\nAfter`)
    v.dom.querySelector<HTMLElement>('.abele-chat-reply-card__remove')!.click()
    expect(v.state.doc.toString()).toBe('Before\nAfter')
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
