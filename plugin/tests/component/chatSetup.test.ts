/**
 * Everything a chat is set up with, in one dialog: only settings. Skills and prompts went to the
 * «/» list in the composer, reloading, copying the debug data and deleting to the header's ⋯.
 * What is asserted here is the strip and the wiring: three tabs, a caller can open the dialog on
 * the one it means, and the dialog is named after its chat.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import AiChatSetup from '@/components/AiChatSetup.vue'
import Tabs from '@/components/obsidian/Tabs.vue'
import AiScopeManager from '@/components/AiScopeManager.vue'
import AiPermissions from '@/components/AiPermissions.vue'
import AiChatSettings from '@/components/AiChatSettings.vue'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

/** The bodies are tested where they live; here only which one is on screen. */
const stubs = {
  ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' },
  AiScopeManager: true,
  AiPermissions: true,
  AiChatSettings: true,
}

const mountSetup = (props: { open?: string } = {}) =>
  mount(AiChatSetup, { props, global: { stubs } })

beforeEach(() => {
  useVault([])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [] }
  vi.spyOn(ChatService, 'getInstance').mockReturnValue({
    activeSession: shallowRef(null),
  } as never)
})

describe('the dialog a chat is set up in', () => {
  it('offers access, tools and the chat, which fit a phone in one row', () => {
    const tabs = mountSetup().findComponent(Tabs).props('tabs')

    expect(tabs.map((tab) => tab.id)).toEqual(['scope', 'permissions', 'settings'])
    expect(tabs.map((tab) => tab.label)).toEqual(['Access', 'Tools', 'Chat'])
  })

  /**
   * Words and no glyphs: six labels *and* six icons wrap onto a second row at the width this
   * dialog opens at, and these labels are plain words that need no drawing beside them.
   */
  it('says in words what each tab is, and in more words on hover', () => {
    const tabs = mountSetup().findComponent(Tabs).props('tabs')

    expect(tabs.every((tab) => !!tab.label && !!tab.tooltip)).toBe(true)
    expect(tabs.some((tab) => !!tab.icon)).toBe(false)
  })

  it('opens where it was asked to, so a way in lands on what it was about', () => {
    expect(mountSetup({ open: 'permissions' }).findComponent(Tabs).props('modelValue')).toBe(
      'permissions'
    )
  })

  it('opens on the access for a tab it no longer has', () => {
    expect(mountSetup({ open: 'prompts' }).findComponent(Tabs).props('modelValue')).toBe('scope')
  })

  it('opens on the scope when nobody said otherwise', () => {
    expect(mountSetup().findComponent(Tabs).props('modelValue')).toBe('scope')
  })

  it('shows one surface at a time, and the one the strip says', async () => {
    const view = mountSetup()
    expect(view.findComponent(AiScopeManager).exists()).toBe(true)
    expect(view.findComponent(AiChatSettings).exists()).toBe(false)

    await view.findComponent(Tabs).vm.$emit('update:modelValue', 'settings')

    expect(view.findComponent(AiChatSettings).exists()).toBe(true)
    expect(view.findComponent(AiScopeManager).exists()).toBe(false)
  })

  it('carries the permissions surface, which has no dialog of its own any more', async () => {
    const view = mountSetup()

    await view.findComponent(Tabs).vm.$emit('update:modelValue', 'permissions')

    expect(view.findComponent(AiPermissions).exists()).toBe(true)
  })
})
