import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import ChatTreePanel from '@/components/chatTree/ChatTreePanel.vue'
import { CHAT_TREE_SOURCE, chatTreeSource, type ChatTreeSource } from '@/chats/chatTree'
import { useVault } from '../helpers/testEnv'
import ChatToolModes from '@/components/ChatToolModes.vue'
import { Menu } from 'obsidian'

let source: ChatTreeSource
const views: ReturnType<typeof mount>[] = []
beforeEach(() => {
  useVault([])
  source = {
    root: shallowRef([
      { kind: 'chat', id: 'sample', title: 'Sample chat', open: true, at: 1 },
      { kind: 'chat', id: 'closed', title: 'Archived sample', open: false, at: 1 },
    ]),
    activeId: shallowRef('sample'),
    open: vi.fn(),
    close: vi.fn(),
    move: vi.fn(),
    newChat: vi.fn(),
    newFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    folderAccess: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
  }
  chatTreeSource.value = source
})
afterEach(() => {
  views.forEach((view) => view.unmount())
  views.length = 0
  chatTreeSource.value = null
})
const show = () => {
  const view = mount(ChatTreePanel, { attachTo: document.body })
  views.push(view)
  return view
}

it('creates a folder through an inline name field', async () => {
  const view = show()
  await view.get('[aria-label="New folder"]').trigger('click')
  const input = view.get('input[aria-label="Folder name"]')
  await input.setValue('Projects')
  await input.trigger('keydown', { key: 'Enter' })
  expect(source.newFolder).toHaveBeenCalledWith('', 'Projects')
})

it('uses the tree and actions belonging to its own pane', async () => {
  const open = vi.fn()
  const local = {
    ...source,
    root: shallowRef([
      { kind: 'chat' as const, id: 'other', title: 'Other pane', open: true, at: 1 },
    ]),
    open,
  }
  const view = mount(ChatTreePanel, {
    global: { provide: { [CHAT_TREE_SOURCE as symbol]: shallowRef(local) } },
  })
  views.push(view)
  expect(view.text()).toContain('Other pane')
  expect(view.find('[data-chat="sample"]').exists()).toBe(false)
  await view.get('[data-chat="other"] .tree-item-self').trigger('click')
  expect(open).toHaveBeenCalledWith('other')
  expect(source.open).not.toHaveBeenCalled()
})

it('searches open chats first, then closed chats when requested', async () => {
  const view = show()
  await view.get('input').setValue('Archived')
  expect(view.text()).toContain('No matches')
  await view.get('[aria-label="Search closed chats"]').trigger('click')
  expect(view.text()).toContain('Archived sample')
  await view.get('[data-chat="closed"] .tree-item-self').trigger('click')
  expect(source.open).toHaveBeenCalledWith('closed')
  expect(view.emitted('close')).toHaveLength(1)
})

it('moves keyboard focus from search into the tree and opens with Enter', async () => {
  const view = show()
  await view.get('input').trigger('keydown', { key: 'ArrowDown' })
  expect(document.activeElement).toBe(view.get('[data-chat="sample"] .tree-item-self').element)
  await view.get('[data-chat="sample"] .tree-item-self').trigger('keydown', { key: 'Enter' })
  expect(source.open).toHaveBeenCalledWith('sample')
})

it('keeps a closed child of an open chat reachable in the folder closed branch', async () => {
  source.root.value[0].children = [
    {
      kind: 'chat',
      id: 'child',
      title: 'Sample discussion',
      open: false,
      at: 1,
      nested: 'discussion',
    },
  ]
  const view = show()
  expect(view.find('[data-chat="child"]').exists()).toBe(false)
  await view.get('.abele-chat-tree__closed > .tree-item-self').trigger('click')
  expect(view.find('[data-chat="child"]').exists()).toBe(true)
  await view.get('[data-chat="child"] > .tree-item-self').trigger('click')
  expect(source.open).toHaveBeenCalledWith('child')
})

it('disables tool modes below a folder floor and retains each floor during bulk edits', async () => {
  const menuShown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const view = mount(ChatToolModes, {
    props: { toolModes: { web_search: 'auto' }, floor: { web_search: 'auto' } },
  })
  views.push(view)
  try {
    await view.get('.abele-chat-tools__all').trigger('click')
    const menu = menuShown.mock.contexts.at(-1) as Menu
    expect(menu.items.find((item) => item.isLabel)?.title).toContain('Adds to the default')
    menu.items.find((item) => item.title === 'Ask first')!.handler!()
    expect(view.emitted('updateMany')![0][0]).toMatchObject({ web_search: 'auto' })
  } finally {
    menuShown.mockRestore()
  }
})
