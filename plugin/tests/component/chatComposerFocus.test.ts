/**
 * The chat puts the cursor in its composer when asked, and keeps trying for a moment when the
 * composer cannot take it yet.
 *
 * A focus given to something not yet on screen is dropped without a word: the panel's leaf is
 * still being made, a phone's drawer is still sliding in, the tab that was just added has not
 * rendered. One try a tick later was a race the new chat lost as often as it won.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'
import { useFakeClock } from '../helpers/fakeClock'
const wait = useFakeClock()

let service: ChatService
const mounted: Array<ReturnType<typeof mount>> = []

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  service = ChatService.getInstance()
  service.tabOrder.value = ['tab-a']
  service.activeTabId.value = 'tab-a'
  service.pendingInput.value = null
  service.openingSelection.value = false
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeChatSession({ messages: ref<ChatMessage[]>([]), kind: 'chat' }),
  } as never)
})

afterEach(() => {
  for (const w of mounted.splice(0)) w.unmount()
  vi.restoreAllMocks()
})

const open = () => {
  const wrapper = mount(AiChat, { attachTo: document.body })
  mounted.push(wrapper)
  return wrapper
}
const textarea = (wrapper: ReturnType<typeof open>) =>
  wrapper.get('.abele-chat-input__textarea').element as HTMLTextAreaElement

/** The composer refuses the first `times` focuses, the way one not yet on screen does. */
function refuseFocus(el: HTMLTextAreaElement, times: number) {
  const real = el.focus.bind(el)
  let left = times
  el.focus = (options?: FocusOptions) => {
    if (left > 0) {
      left--
      return
    }
    real(options)
  }
}

describe('the cursor in the composer', () => {
  it('is not requested by a selection return opening the sidebar', async () => {
    service.openingSelection.value = true
    const wrapper = open()
    await wait(600)
    expect(document.activeElement).not.toBe(textarea(wrapper))
    service.openingSelection.value = false
  })

  it('is put there when the chat opens, even if the first tries are dropped', async () => {
    const wrapper = open()
    refuseFocus(textarea(wrapper), 3)

    await wait(600)

    expect(document.activeElement).toBe(textarea(wrapper))
  })

  it('is put there when a new chat asks for it, even if the first tries are dropped', async () => {
    const wrapper = open()
    await wait(300)
    textarea(wrapper).blur()
    expect(document.activeElement).not.toBe(textarea(wrapper))
    refuseFocus(textarea(wrapper), 3)

    service.focusRequest.value++
    await nextTick()
    await wait(400)

    expect(document.activeElement).toBe(textarea(wrapper))
  })

  it('goes after what is already typed there', async () => {
    const wrapper = open()
    await wait(300)
    await wrapper.get('.abele-chat-input__textarea').setValue('half a thought')
    textarea(wrapper).blur()
    textarea(wrapper).setSelectionRange(0, 0)

    service.focusRequest.value++
    await nextTick()
    await wait(100)

    expect(document.activeElement).toBe(textarea(wrapper))
    expect(textarea(wrapper).selectionStart).toBe('half a thought'.length)
  })

  it('focuses only an explicit Reply at the exact waiting question, without sending', async () => {
    const answer = vi.fn()
    const session = fakeChatSession({
      kind: 'chat',
      overrides: {
        pendingQuestions: ref({
          id: 'sample-question',
          questions: [{ question: 'Which sample folder?', options: [] }],
          currentIndex: 0,
          answers: [],
        }),
        answerCurrentQuestion: answer,
      },
    })
    vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
    service.openingSelection.value = true
    const wrapper = open()
    await wait(100)
    service.openingSelection.value = false
    const question = wrapper.get('.abele-ai-chat__questions').element as HTMLElement
    const scroll = vi.spyOn(question, 'scrollIntoView')
    service.pendingAttentionReveal.value = {
      sessionId: session.id,
      kind: 'question',
      id: 'sample-question',
      focusComposer: true,
    }
    await nextTick()
    await wait(200)
    expect(scroll).toHaveBeenCalledWith({ block: 'center' })
    expect(document.activeElement).toBe(textarea(wrapper))
    expect(answer).not.toHaveBeenCalled()
  })

  it('does not focus for ordinary attention opening or a stale Reply', async () => {
    service.openingSelection.value = true
    const wrapper = open()
    await wait(100)
    service.openingSelection.value = false
    for (const focusComposer of [false, true]) {
      service.pendingAttentionReveal.value = {
        sessionId: 'session-1',
        kind: 'question',
        id: 'gone-question',
        focusComposer,
      }
      await nextTick()
      await wait(100)
      expect(document.activeElement).not.toBe(textarea(wrapper))
    }
  })

  it('is asked for by the + in the tab bar', async () => {
    const newTab = vi.spyOn(service, 'newTab').mockReturnValue('tab-b')
    const create = vi.spyOn(service, 'createTab')
    const wrapper = open()

    await wrapper.get('.abele-chat-tabs__add').trigger('click')

    expect(newTab).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
  })
})
