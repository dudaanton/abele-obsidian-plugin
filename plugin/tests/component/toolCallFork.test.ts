import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu } from 'obsidian'
import AiChatMessage from '@/components/AiChatMessage.vue'
import type { ChatMessage } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
const message: ChatMessage = {
  id: 'sample-call-row',
  role: 'tool-call',
  content: '',
  timestamp: 1,
  toolName: 'read',
  toolStatus: 'approved',
  toolResult: '',
}
describe('explicit finished-call forks', () => {
  it('offers the glyph for a finished empty result and emits only a branch request', async () => {
    const view = mount(AiChatMessage, { props: { message } })
    await view.get('.abele-chat-msg__tool-branch').trigger('click')
    expect(view.emitted('create-branch')).toEqual([['sample-call-row']])
    expect(view.emitted('retry-message')).toBeUndefined()
    view.unmount()
  })
  it.each([{ readOnlyHistory: true }, { branchBlocked: true }])(
    'does not offer an executable fork in unavailable histories: %j',
    (props) => {
      const view = mount(AiChatMessage, { props: { message, ...props } })
      const action = view.find('.abele-chat-msg__tool-branch')
      expect(!action.exists() || action.attributes('disabled') !== undefined).toBe(true)
      view.unmount()
    }
  )
  it('opens the native menu at a right-clicked call instead of using a button-only anchor', async () => {
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const view = mount(AiChatMessage, { props: { message } })
    await view.get('.abele-chat-msg__tool-line').trigger('contextmenu')
    const menu = shown.mock.contexts.at(-1) as Menu
    expect(menu.items.some((item) => item.title === 'Branch from here')).toBe(true)
    menu.items.find((item) => item.title === 'Branch from here')!.handler!()
    expect(view.emitted('create-branch')).toEqual([['sample-call-row']])
    view.unmount()
    shown.mockRestore()
  })
})
