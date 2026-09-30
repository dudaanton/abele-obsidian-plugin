/**
 * The chat's composer is Obsidian's note editor, and it opens out over the whole chat for
 * writing at length.
 *
 * The editor itself only exists in the running app (the e2e tier drives it there); here it is
 * the stand-in from `fakeNoteEditor`, which reports text, focus and keys through the same
 * options. What is checked is the composer's side of it: the keys that send and keep a note,
 * the text surviving every change of size, attachments with it, and the chat giving the
 * composer its whole height while it is open.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'
import { TFile } from 'obsidian'
import AiChatInput from '@/components/AiChatInput.vue'
import AiChat from '@/components/AiChat.vue'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'
import { fakeChatSession } from '../helpers/fakeChatSession'
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

function composer(props: Record<string, unknown> = {}) {
  const wrapper = mount(AiChatInput, {
    attachTo: document.body,
    props: {
      isStreaming: false,
      isBusy: false,
      canContinue: false,
      tokenDisplay: '',
      scopeLabel: '',
      ...props,
    },
  })
  mounted.push(wrapper)
  return wrapper
}

const editor = () => fakeNoteEditors[fakeNoteEditors.length - 1]
const expandButton = (wrapper: ReturnType<typeof composer>) =>
  wrapper.get('.abele-chat-input__expand')

function file(path: string): TFile {
  const f = new TFile()
  Object.assign(f, { path, name: path.split('/').pop(), basename: path.replace(/\.\w+$/, '') })
  return f
}

describe('the composer is a note editor', () => {
  it('is written in the note editor, not a text box', () => {
    const wrapper = composer()
    expect(fakeNoteEditors).toHaveLength(1)
    expect(wrapper.find('textarea.abele-chat-input__textarea').exists()).toBe(false)
    expect(wrapper.find('.abele-chat-input__field .fake-note-editor').exists()).toBe(true)
  })

  it('sends on Shift+Enter what was written, markdown and links as they are', async () => {
    const wrapper = composer()
    editor().type('see [[sample-note]] and **this**')
    expect(editor().press('Shift-Enter')).toBe(true)
    expect(wrapper.emitted('send')?.[0]).toEqual(['see [[sample-note]] and **this**', []])
    await nextTick()
    expect(editor().value).toBe('')
  })

  it('sends on Mod+Enter as well', () => {
    const wrapper = composer()
    editor().type('hello')
    editor().submit()
    expect(wrapper.emitted('send')?.[0]).toEqual(['hello', []])
  })

  it('keeps a note on Alt+Enter over a comment, and leaves the key alone anywhere else', () => {
    const comment = composer({ canNote: true })
    editor().type('come back to this')
    expect(editor().press('Alt-Enter')).toBe(true)
    expect(comment.emitted('note')?.[0]).toEqual(['come back to this'])

    const plain = composer()
    editor().type('not a note')
    expect(editor().press('Alt-Enter')).toBe(false)
    expect(plain.emitted('note')).toBeUndefined()
  })

  it('puts text given from outside into the editor', async () => {
    const wrapper = composer()
    ;(wrapper.vm as unknown as { setText(v: string): void }).setText('quoted words')
    await nextTick()
    expect(editor().value).toBe('quoted words')
  })

  it('tells the chat when it takes and loses the focus', async () => {
    const wrapper = composer()
    ;(wrapper.vm as unknown as { focus(): void }).focus()
    expect((wrapper.vm as unknown as { hasFocus(): boolean }).hasFocus()).toBe(true)
    editor().host.querySelector<HTMLElement>('.fake-note-editor')!.blur()
    expect((wrapper.emitted('focus') ?? []).map((e) => e[0])).toEqual([true, false])
  })
})

describe('opening the composer out', () => {
  it('opens with its own button and closes with the same one', async () => {
    const wrapper = composer()
    expect(expandButton(wrapper).attributes('aria-label')).toBe('Expand the message field')

    await expandButton(wrapper).trigger('click')
    expect(wrapper.classes()).toContain('abele-chat-input--expanded')
    expect(wrapper.emitted('update:expanded')?.[0]).toEqual([true])
    expect(expandButton(wrapper).attributes('aria-label')).toBe('Collapse the message field')

    await expandButton(wrapper).trigger('click')
    expect(wrapper.classes()).not.toContain('abele-chat-input--expanded')
    expect(wrapper.emitted('update:expanded')?.[1]).toEqual([false])
  })

  it('keeps the draft, the attachments and the same editor through both', async () => {
    const wrapper = composer()
    editor().type('a long thought, half written')
    ;(wrapper.vm as unknown as { addAttachment(f: TFile): void }).addAttachment(
      file('sample-note.md')
    )
    await nextTick()

    await expandButton(wrapper).trigger('click')
    await expandButton(wrapper).trigger('click')

    expect(fakeNoteEditors).toHaveLength(1)
    expect(editor().value).toBe('a long thought, half written')
    expect(wrapper.findAll('.abele-chat-input__attachment')).toHaveLength(1)
    editor().press('Shift-Enter')
    expect(wrapper.emitted('send')?.[0]).toEqual([
      'a long thought, half written',
      ['sample-note.md'],
    ])
  })

  it('closes when the message is sent, so the answer can be read', async () => {
    const wrapper = composer()
    await expandButton(wrapper).trigger('click')
    editor().type('done writing')
    editor().press('Shift-Enter')
    await nextTick()
    expect(wrapper.classes()).not.toContain('abele-chat-input--expanded')
  })
})

describe('the chat around an opened composer', () => {
  let session: ReturnType<typeof fakeChatSession>

  beforeEach(() => {
    const service = ChatService.getInstance()
    service.tabOrder.value = ['tab-a']
    service.activeTabId.value = 'tab-a'
    service.pendingInput.value = null
    session = fakeChatSession({ messages: ref<ChatMessage[]>([]), kind: 'chat' })
    vi.spyOn(service, 'ensureInitialized').mockImplementation(() => {})
    vi.spyOn(service, 'activeSession', 'get').mockReturnValue({ value: session } as never)
  })

  it('keeps the keyboard layout on while the field has the focus through opening out', async () => {
    const wrapper = mount(AiChat, { attachTo: document.body })
    mounted.push(wrapper)
    await nextTick()
    editor().host.querySelector<HTMLElement>('.fake-note-editor')!.focus()
    await nextTick()
    expect(wrapper.classes()).toContain('abele-keyboard-open')

    await wrapper.get('.abele-chat-input__expand').trigger('click')
    await nextTick()
    expect(wrapper.classes()).toContain('abele-ai-chat--composing')
    expect(wrapper.classes()).toContain('abele-keyboard-open')
  })

  it('closes it when the agent asks a question, and what was written stays', async () => {
    const wrapper = mount(AiChat, { attachTo: document.body })
    mounted.push(wrapper)
    await nextTick()
    await wrapper.get('.abele-chat-input__expand').trigger('click')
    editor().type('still writing')

    session.pendingQuestions.value = {
      questions: [{ question: 'Which one?', options: ['a', 'b'] }],
      currentIndex: 0,
    }
    await nextTick()
    await nextTick()

    expect(wrapper.classes()).not.toContain('abele-ai-chat--composing')
    expect(wrapper.find('.abele-chat-input--expanded').exists()).toBe(false)
    expect(wrapper.find('.abele-ai-chat__questions').exists()).toBe(true)
    expect(editor().value).toBe('still writing')
  })

  it('replaces an unsent picture returned from drawing without losing the draft', async () => {
    const app = useVault([
      { path: 'sample-image.png', content: '' },
      { path: 'sample-image-drawn.png', content: '' },
      { path: 'sample-note.md', content: '' },
    ])
    ;(app.vault as any).getResourcePath = (f: TFile) => `app://sample/${f.path}`
    const wrapper = mount(AiChat, { attachTo: document.body })
    mounted.push(wrapper)
    await nextTick()
    const input = wrapper.getComponent(AiChatInput)
    input.vm.addAttachment(app.vault.getAbstractFileByPath('sample-image.png') as TFile)
    input.vm.addAttachment(app.vault.getAbstractFileByPath('sample-note.md') as TFile)
    editor().type('half written')
    ChatService.getInstance().pendingInput.value = {
      text: '', tabId: 'tab-a', attachments: ['sample-image-drawn.png'],
      replaceAttachment: 'sample-image.png',
    }
    await nextTick()
    await nextTick()
    expect(input.vm.takeDraft().attachments.map((f: TFile) => f.path)).toEqual([
      'sample-note.md', 'sample-image-drawn.png',
    ])
    expect(editor().value).toBe('half written')
  })

  it('gives the composer the room the conversation had, and gives it back', async () => {
    const wrapper = mount(AiChat, { attachTo: document.body })
    mounted.push(wrapper)
    await nextTick()
    const messages = () => wrapper.get('.abele-ai-chat__messages').element as HTMLElement

    await wrapper.get('.abele-chat-input__expand').trigger('click')
    expect(wrapper.classes()).toContain('abele-ai-chat--composing')
    expect(messages().style.display).toBe('none')

    await wrapper.get('.abele-chat-input__expand').trigger('click')
    expect(wrapper.classes()).not.toContain('abele-ai-chat--composing')
    expect(messages().style.display).toBe('')
  })
})
