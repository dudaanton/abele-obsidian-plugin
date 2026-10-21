import { catalogs as testCatalogs } from '@/i18n/catalogs'
/**
 * The chat's tools, as a tree: groups with a count and the group's mode glyph, tools under them
 * with their own. A glyph opens the three modes; the group's sets every tool in it at once.
 * Tools that are always there take no choice and stay folded under «Always on».
 */
import { initializeLocale } from '@/i18n'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu } from 'obsidian'
import ChatToolModes from '@/components/ChatToolModes.vue'
import TreeItem from '@/components/obsidian/TreeItem.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, CORE_TOOLS } from '@/ai/types'
import { getToolRegistry } from '@/ai/tools'
import { useVault } from '../helpers/testEnv'
import { shallowRef } from 'vue'
import AiPermissions from '@/components/AiPermissions.vue'
import { ChatService } from '@/ai/ChatService'
import { fakeChatSession } from '../helpers/fakeChatSession'

beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, mcpServers: [] }
})

const files = () => getToolRegistry().filter((tool) => tool.category === 'Files')
const optionalFiles = () => files().filter((tool) => !CORE_TOOLS.has(tool.name))
const keyOf = (tool: { name: string; permissionKey?: string }) => tool.permissionKey ?? tool.name
const group = (view: ReturnType<typeof mount>, name: string) =>
  view.findAllComponents(TreeItem).find((item) => item.props('text') === name)!

describe('the tools a chat may use', () => {
  it('uses the supplied node registry with the same group menu, including controllable core tools', async () => {
    const view = mount(ChatToolModes, {
      props: {
        registry: [
          { name: 'read', label: 'Read file', category: 'Files', description: 'Read a file' },
        ],
        coreModes: true,
        floor: {},
        toolModes: { read: 'ask' },
      },
    })
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    try {
      expect(view.findAll('[data-tool-group]')).toHaveLength(1)
      expect(group(view, 'Files').props('flair')).toBe('1')
      await view.get('.abele-chat-tools__all').trigger('click')
      const menu = shown.mock.contexts.at(-1) as Menu
      menu.items.find((item) => item.title === 'Run on its own')!.handler!()
      expect(view.emitted('updateMany')).toEqual([[{ read: 'auto' }]])
    } finally {
      view.unmount()
      shown.mockRestore()
    }
  })
  it('changes one tool through the permissions surface without changing its peers', async () => {
    const tool = optionalFiles()[0]
    const key = keyOf(tool)
    const peer = keyOf(optionalFiles().find((other) => keyOf(other) !== key)!)
    const session = fakeChatSession({ overrides: { isOverridden: () => false } })
    session.toolModes.value = { [key]: 'off', [peer]: 'auto' }
    const service = vi
      .spyOn(ChatService, 'getInstance')
      .mockReturnValue({ activeSession: shallowRef(session) } as never)
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const view = mount(AiPermissions)
    try {
      await group(view, 'Files').get('.tree-item-self').trigger('click')
      await group(view, tool.label).get('.abele-tree-item__end .clickable-icon').trigger('click')
      const menu = shown.mock.contexts.at(-1) as Menu
      menu.items.find((item) => item.title === 'Ask first')!.handler!()
      await view.vm.$nextTick()
      expect(session.toolModes.value).toEqual({ [key]: 'ask', [peer]: 'auto' })
    } finally {
      view.unmount()
      shown.mockRestore()
      service.mockRestore()
    }
  })
  it('keeps a mode button Enter key with the button without folding the group', async () => {
    const view = mount(ChatToolModes, { props: { toolModes: {} } })
    const files_ = group(view, 'Files')
    const button = files_.get('.abele-tree-item__end .clickable-icon')
    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    button.element.dispatchEvent(key)
    await view.vm.$nextTick()
    expect(key.defaultPrevented).toBe(false)
    expect(files_.props('collapsed')).toBe(true)
    view.unmount()
  })
  it('lists each group with its count and one glyph for the mode its tools share', () => {
    const modes = Object.fromEntries(optionalFiles().map((tool) => [keyOf(tool), 'ask' as const]))
    const view = mount(ChatToolModes, { props: { toolModes: modes } })
    const files_ = group(view, 'Files')
    expect(files_.props('flair')).toBe(String(files().length))
    expect(files_.get('.abele-tree-item__end [data-icon="shield-question"]').exists()).toBe(true)
  })

  it('sets every tool of a group from its glyph, through the three modes', async () => {
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const view = mount(ChatToolModes, { props: { toolModes: {} } })
    await group(view, 'Files').get('.abele-tree-item__end .clickable-icon').trigger('click')
    const menu = shown.mock.contexts.at(-1) as Menu
    expect(menu.items.map((item) => item.title)).toEqual(['Ask first', 'Run on its own', 'Off'])
    // Every tool is off to start with, so Off is ticked.
    expect(menu.items.map((item) => item.checked)).toEqual([false, false, true])
    menu.items[1].handler!()
    const [modes] = view.emitted('updateMany')!.at(-1) as [Record<string, string>]
    expect(Object.keys(modes).sort()).toEqual(optionalFiles().map(keyOf).sort())
    expect(new Set(Object.values(modes))).toEqual(new Set(['auto']))
  })

  it('folds the tools that are always on into one branch with their count', async () => {
    const view = mount(ChatToolModes, { props: { toolModes: {} } })
    await group(view, 'Files').get('.tree-item-self').trigger('click')
    const core = files().filter((tool) => CORE_TOOLS.has(tool.name))
    const always = group(view, 'Always on')
    expect(always.props('flair')).toBe(String(core.length))
    expect(always.props('collapsed')).toBe(true)
  })

  it('narrows to the tools whose names match, and opens their groups', async () => {
    const view = mount(ChatToolModes, { props: { toolModes: {} } })
    const label = optionalFiles()[0].label
    await view.get('input[type="search"]').setValue(label)
    expect(group(view, 'Files').props('collapsed')).toBe(false)
    expect(group(view, label).exists()).toBe(true)
  })
})

it('translates mode menus while emitting stable permission values in every language', async () => {
  for (const language of ['ru', 'lv', 'es', 'de']) {
    initializeLocale(language, testCatalogs[language as keyof typeof testCatalogs])
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const view = mount(ChatToolModes, { props: { toolModes: {} } })
    try {
      await view
        .get('[data-tool-group="Files"] .abele-tree-item__end .clickable-icon')
        .trigger('click')
      const menu = shown.mock.contexts.at(-1) as Menu
      expect(menu.items[2].checked).toBe(true)
      expect(menu.items.map((item) => item.title)).not.toEqual([
        'Ask first',
        'Run on its own',
        'Off',
      ])
      for (const [index, mode] of ['ask', 'auto', 'off'].entries()) {
        menu.items[index].handler!()
        const [modes] = view.emitted('updateMany')!.at(-1) as [Record<string, string>]
        expect(new Set(Object.values(modes))).toEqual(new Set([mode]))
      }
    } finally {
      view.unmount()
      shown.mockRestore()
      initializeLocale('en', testCatalogs['en' as keyof typeof testCatalogs])
    }
  }
})
