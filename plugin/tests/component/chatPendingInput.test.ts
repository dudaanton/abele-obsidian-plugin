/**
 * Text put into the composer from outside — "Chat about this" writes a link to the note there.
 *
 * It comes with a tab switch more often than not, and the switch puts the new tab's own draft
 * back a tick later: text that did not know which tab it was for was wiped by an empty draft.
 * And the sidebar may not be open yet, in which case the chat mounts after the text arrived.
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

const messages = ref<ChatMessage[]>([])
let service: ChatService

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  messages.value = []
  service = ChatService.getInstance()
  service.tabOrder.value = ['tab-a', 'tab-b']
  service.activeTabId.value = 'tab-a'
  service.pendingInput.value = null
  vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
  vi.spyOn(service, 'activeSession', 'get').mockReturnValue({
    value: fakeChatSession({ messages, kind: 'chat' }),
  } as never)
})

// Unmounted after each test: a chat left mounted keeps watching the service and would take
// the next test's text before the chat under test could.
const mounted: Array<ReturnType<typeof mount>> = []

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

const settle = async () => {
  for (let i = 0; i < 4; i++) await nextTick()
}

describe('text put into the composer from outside', () => {
  it('lands in the tab in front, focused, with the cursor after it', async () => {
    const wrapper = open()

    service.pendingInput.value = { text: '[[Budget]] ', tabId: 'tab-a', focus: true }
    await settle()

    const el = textarea(wrapper)
    expect(el.value).toBe('[[Budget]] ')
    expect(document.activeElement).toBe(el)
    expect(el.selectionStart).toBe('[[Budget]] '.length)
    expect(service.pendingInput.value).toBeNull()
  })

  it('survives the tab switch it came with', async () => {
    const wrapper = open()
    await wrapper.get('.abele-chat-input__textarea').setValue('typed in A')

    service.activeTabId.value = 'tab-b'
    service.pendingInput.value = { text: '[[Budget]] ', tabId: 'tab-b', focus: true }
    await settle()

    expect(textarea(wrapper).value).toBe('[[Budget]] ')

    // And what was being typed in the tab left behind is still its own.
    service.activeTabId.value = 'tab-a'
    await settle()
    expect(textarea(wrapper).value).toBe('typed in A')
  })

  it('survives it whichever of the two is set first', async () => {
    const wrapper = open()

    service.pendingInput.value = { text: '[[Budget]] ', tabId: 'tab-b', focus: true }
    service.activeTabId.value = 'tab-b'
    await settle()

    expect(textarea(wrapper).value).toBe('[[Budget]] ')
  })

  it('waits for the chat to open when the sidebar was closed', async () => {
    service.pendingInput.value = { text: '[[Budget]] ', tabId: 'tab-a', focus: true }

    const wrapper = open()
    await settle()

    expect(textarea(wrapper).value).toBe('[[Budget]] ')
    expect(document.activeElement).toBe(textarea(wrapper))
  })

  it('is not put into a tab it was not meant for', async () => {
    const wrapper = open()

    service.pendingInput.value = { text: '[[Budget]] ', tabId: 'tab-b' }
    await settle()

    expect(textarea(wrapper).value).toBe('')
    expect(service.pendingInput.value).not.toBeNull()
  })

  it('attaches a picture sent back beside what is typed, in front or with a tab switch', async () => {
    useVault([
      { path: 'Pics/cat drawn.png', raw: 'png' },
      { path: 'Pics/dog drawn.png', raw: 'png' },
    ])
    const wrapper = open()
    await wrapper.get('.abele-chat-input__textarea').setValue('look at this')
    service.pendingInput.value = { text: '', tabId: 'tab-a', attachments: ['Pics/cat drawn.png'] }
    await settle()
    expect(textarea(wrapper).value).toBe('look at this')
    const chips = () => wrapper.findAll('.abele-chat-input__attachment').map((c) => c.text())
    expect(chips().join()).toContain('cat drawn.png')

    service.activeTabId.value = 'tab-b'
    service.pendingInput.value = { text: '', tabId: 'tab-b', attachments: ['Pics/dog drawn.png'] }
    await settle()
    expect(chips().join()).toContain('dog drawn.png')
    expect(chips().join()).not.toContain('cat drawn.png')
  })
})
