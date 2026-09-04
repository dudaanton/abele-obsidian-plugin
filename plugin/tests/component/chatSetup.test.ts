/**
 * Everything a chat is set up with, in one dialog.
 *
 * It used to be six controls in two places — three glyphs in the composer, three in the header
 * — each opening a dialog of its own. What is asserted here is the strip and the wiring: that
 * every surface is on it, that a caller can open the dialog on the one it means, and that the
 * two actions in the last tab are actions rather than settings and close behind themselves.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import AiChatSetup from '@/components/AiChatSetup.vue'
import Tabs from '@/components/obsidian/Tabs.vue'
import Button from '@/components/obsidian/Button.vue'
import AiScopeManager from '@/components/AiScopeManager.vue'
import AiSkillPromptPicker from '@/components/AiSkillPromptPicker.vue'
import AiPermissions from '@/components/AiPermissions.vue'
import AiChatSettings from '@/components/AiChatSettings.vue'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

/** The bodies are tested where they live; here only which one is on screen. */
const stubs = {
  ObsidianModal: { template: '<div><slot /></div>' },
  AiScopeManager: true,
  AiSkillPromptPicker: true,
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
  it('offers every surface that used to be a dialog of its own', () => {
    const tabs = mountSetup().findComponent(Tabs).props('tabs')

    expect(tabs.map((tab) => tab.id)).toEqual([
      'scope',
      'skills',
      'prompts',
      'permissions',
      'settings',
      'tools',
    ])
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
    expect(mountSetup({ open: 'prompts' }).findComponent(Tabs).props('modelValue')).toBe('prompts')
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

  it('tells the picker which of the two lists it is', async () => {
    const view = mountSetup({ open: 'skills' })
    expect(view.findComponent(AiSkillPromptPicker).props('kind')).toBe('skills')

    await view.findComponent(Tabs).vm.$emit('update:modelValue', 'prompts')

    expect(view.findComponent(AiSkillPromptPicker).props('kind')).toBe('prompts')
  })

  it('carries a picked skill up to the chat', async () => {
    const view = mountSetup({ open: 'skills' })

    await view.findComponent(AiSkillPromptPicker).vm.$emit('skill', 'summarise')

    expect(view.emitted('skill')).toEqual([['summarise']])
  })

  it('carries the permissions surface, which has no dialog of its own any more', async () => {
    const view = mountSetup()

    await view.findComponent(Tabs).vm.$emit('update:modelValue', 'permissions')

    expect(view.findComponent(AiPermissions).exists()).toBe(true)
  })
})

/**
 * The last tab, which is not settings at all: reading the file again and copying what the chat
 * is made of are things you do once and then look at the chat, so both close the dialog.
 */
describe('the troubleshooting tab', () => {
  const openTools = async () => {
    const view = mountSetup()
    await view.findComponent(Tabs).vm.$emit('update:modelValue', 'tools')
    return view
  }

  const press = async (view: Awaited<ReturnType<typeof openTools>>, text: string) => {
    const button = view.findAllComponents(Button).find((one) => one.props('text') === text)
    expect(button).toBeDefined()
    await button!.vm.$emit('click')
  }

  it('reads the chat from its file again, and gets out of the way', async () => {
    const view = await openTools()

    await press(view, 'Reload')

    expect(view.emitted('reload')).toHaveLength(1)
    expect(view.emitted('close')).toHaveLength(1)
  })

  it('copies what the chat is made of, and gets out of the way', async () => {
    const view = await openTools()

    await press(view, 'Copy')

    expect(view.emitted('debug')).toHaveLength(1)
    expect(view.emitted('close')).toHaveLength(1)
  })
})
