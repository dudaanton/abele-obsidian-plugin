/**
 * The approval card for `write_settings`.
 *
 * It fell through to the generic key/value view, which showed the new value and not the old
 * one, said nothing about a value being this device's sync server, and left the before → after
 * line to the tool's result — after the change had run. The card now says what the setting is,
 * what it holds, what it would hold, and — for a field that moves this device's token — where
 * that token would go. The card and the tool read both values through `describeSettingsWrite`,
 * so the two cannot disagree.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { ChatService } from '@/ai/ChatService'
import { DEFAULT_AI_SETTINGS, type ChatMessage } from '@/ai/types'
import { AbeleConfig } from '@/services/AbeleConfig'
import { emptyConnection } from '@/sync/connection'
import { SyncService } from '@/sync/SyncService'
import { useVault } from '../helpers/testEnv'

const OLD = 'https://old.example.com'

beforeEach(() => {
  useVault([])
  vi.spyOn(ChatService.getInstance(), 'activeSession', 'get').mockReturnValue({
    value: undefined,
  } as never)
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, chatFolder: 'AI/Chats' }
  SyncService.getInstance().connection.value = {
    ...emptyConnection(),
    serverUrl: OLD,
    enrolledUrl: OLD,
    vaultId: 'v1',
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  await SyncService.getInstance().destroy()
})

function approval(params: Record<string, unknown>) {
  const message = {
    id: 'm1',
    role: 'tool-call',
    content: '',
    timestamp: 1,
    toolName: 'write_settings',
    toolParams: params,
    toolStatus: 'pending',
  } as ChatMessage
  return mount(AiToolApproval, { props: { message } })
}

describe('approving a change to a setting', () => {
  it('shows the old and the new server address, and where the token would go', () => {
    const wrapper = approval({ path: 'sync.serverUrl', value: 'https://new.example.com' })

    expect(wrapper.find('.abele-tool-approval__path').text()).toBe('sync.serverUrl')
    expect(wrapper.find('.abele-tool-approval__before').text()).toBe(`"${OLD}"`)
    expect(wrapper.find('.abele-tool-approval__after').text()).toBe('"https://new.example.com"')
    const warning = wrapper.find('.abele-tool-approval__warning')
    expect(warning.exists()).toBe(true)
    expect(warning.text()).toContain('Changes where this device syncs')
    expect(warning.text()).toContain('new.example.com')
  })

  it('draws the warning glyph in the warning colour, as decoration nobody clicks', () => {
    const wrapper = approval({ path: 'sync.serverUrl', value: 'https://new.example.com' })

    const glyph = wrapper.find('.abele-tool-approval__warning .abele-obsidian-icon')
    expect(glyph.classes()).toContain('abele-obsidian-icon_color-orange')
    expect(glyph.classes()).toContain('abele-obsidian-icon_no-hover')
  })

  it('shows before → after with no warning for an ordinary setting', () => {
    const wrapper = approval({ path: 'ai.chatFolder', value: 'Chats' })

    expect(wrapper.find('.abele-tool-approval__before').text()).toBe('"AI/Chats"')
    expect(wrapper.find('.abele-tool-approval__after').text()).toBe('"Chats"')
    expect(wrapper.find('.abele-tool-approval__warning').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Only this device')
  })

  it('says a per-device switch touches only this device', () => {
    const wrapper = approval({ path: 'sync.paused', value: 'true' })

    expect(wrapper.find('.abele-tool-approval__warning').exists()).toBe(false)
    expect(wrapper.text()).toContain('Only this device.')
  })

  it('names what it asks about in the header', () => {
    const wrapper = approval({ path: 'ai.chatFolder', value: 'Chats' })

    expect(wrapper.find('.abele-tool-approval__header').text()).toBe('Change a setting')
  })
})
