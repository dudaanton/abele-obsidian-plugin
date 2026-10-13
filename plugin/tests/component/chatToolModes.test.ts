/**
 * The chat's tools, as a tree: groups with a count and the group's mode glyph, tools under them
 * with their own. A glyph opens the three modes; the group's sets every tool in it at once.
 * Tools that are always there take no choice and stay folded under «Always on».
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu } from 'obsidian'
import ChatToolModes from '@/components/ChatToolModes.vue'
import TreeItem from '@/components/obsidian/TreeItem.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, CORE_TOOLS } from '@/ai/types'
import { getToolRegistry } from '@/ai/tools'
import { useVault } from '../helpers/testEnv'

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
