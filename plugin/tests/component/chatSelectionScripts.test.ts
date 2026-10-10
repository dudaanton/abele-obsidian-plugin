import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu, Platform } from 'obsidian'
import AiChatMessage from '@/components/AiChatMessage.vue'
import { SelectionScriptPicker } from '@/scripting/SelectionScriptPicker'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

beforeEach(() => {
  useVault([])
  Platform.isMobile = false
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  AbeleConfig.getInstance().reader = { selectionScripts: [] }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})
const parsed = (name: string, extra = {}): ParsedScript => ({
  path: `Scripts/${name}.js`,
  commandId: '',
  code: '',
  meta: { name, description: 'Sample description', params: [], ...extra },
})

describe('desktop chat selection scripts', () => {
  it('keeps pinned launch actions after native selection disappears and retains Copy and Ask here', async () => {
    const run = vi.fn()
    const capture = vi.fn(() => run)
    const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const wrapper = mount(AiChatMessage, {
      attachTo: document.body,
      props: {
        message: { id: 'sample', role: 'user', content: 'A sample phrase.', timestamp: 1 },
        canComment: true,
        captureScript: capture,
        scripts: [{ script: 'Sample', label: 'Run sample', icon: 'languages', by: 'setting' }],
      },
    })
    await vi.waitFor(() => expect(wrapper.find('.abele-markdown').text()).toContain('sample'))
    const md = wrapper.find('.abele-markdown')
    const range = document.createRange()
    range.setStart(md.element.firstChild!, 2)
    range.setEnd(md.element.firstChild!, 8)
    document.getSelection()!.removeAllRanges()
    document.getSelection()!.addRange(range)
    await md.trigger('contextmenu')
    expect(capture).toHaveBeenCalledWith('sample', 'sample', 2, 'A sample phrase.')
    const menu = show.mock.contexts[0] as unknown as {
      items: { title: string; handler: () => void }[]
    }
    expect(menu.items.map((i) => i.title)).toEqual([
      'Copy',
      'Ask here',
      'Run sample',
      'Other script…',
    ])
    document.getSelection()!.removeAllRanges()
    menu.items[2].handler()
    expect(run).toHaveBeenCalledWith('Sample')
    wrapper.unmount()
  })
})

describe('shared native script picker', () => {
  it('pins independently without running or closing, and gives header membership no misleading unpin action', async () => {
    const book = parsed('Book only', { book: true })
    const chat = parsed('Chat only', { chatSelection: true })
    const plain = parsed('Plain')
    const pick = vi.fn()
    const picker = new SelectionScriptPicker(
      GlobalStore.getInstance().app,
      [plain, book, chat],
      pick,
      'chat'
    )
    expect(picker.getItems().map((s) => s.meta.name)).toEqual(['Chat only', 'Book only', 'Plain'])
    const row = document.createElement('div')
    picker.renderSuggestion({ item: plain, match: null } as any, row)
    const pin = row.querySelector('button')!
    pin.click()
    await vi.waitFor(() =>
      expect(AbeleConfig.getInstance().ai.chatSelectionScripts).toEqual([
        { script: 'Plain', name: '', icon: '' },
      ])
    )
    expect(AbeleConfig.getInstance().reader.selectionScripts).toEqual([])
    expect(pick).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(pin.getAttribute('aria-label')).toBe('Take it off the chat menu'))
    row.addEventListener('keydown', () => pick(plain))
    pin.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
    await vi.waitFor(() => expect(AbeleConfig.getInstance().ai.chatSelectionScripts).toEqual([]))
    expect(pick).not.toHaveBeenCalled()
    pin.click()
    await vi.waitFor(() =>
      expect(AbeleConfig.getInstance().ai.chatSelectionScripts).toHaveLength(1)
    )
    const headed = document.createElement('div')
    picker.renderSuggestion({ item: chat, match: null } as any, headed)
    headed.querySelector('button')!.click()
    expect(AbeleConfig.getInstance().ai.chatSelectionScripts).toHaveLength(1)
    expect(pick).not.toHaveBeenCalled()
    picker.onChooseItem(plain)
    expect(pick).toHaveBeenCalledWith(plain)
  })
})
