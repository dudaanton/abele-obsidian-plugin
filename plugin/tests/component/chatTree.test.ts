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

it('offers moving and dragging node chats using the existing folder picker', async () => {
  source.root.value = [
    { kind: 'chat', id: 'node:sample', title: 'Sample node', nested: 'node', open: true, at: 1 },
  ]
  const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const view = show()
  await view.get('[data-chat="node:sample"] > .tree-item-self').trigger('contextmenu')
  const menu = shown.mock.contexts.at(-1) as Menu
  expect(menu.items.some((item) => item.title === 'Move to…')).toBe(true)
  expect(menu.items.some((item) => item.title === 'Rename…')).toBe(true)
  expect(menu.items.some((item) => item.title === 'Delete')).toBe(true)
  expect(view.get('[data-chat="node:sample"]').attributes('draggable')).toBe('true')
  shown.mockRestore()
})

it('leaves no time column for a new chat and no extra creation action beside search', () => {
  source.root.value = [{ kind: 'chat', id: 'new', title: 'New chat', open: true, at: 0 }]
  const view = show()
  expect(view.find('time').exists()).toBe(false)
  expect(view.find('.abele-chat-tree__head [aria-label="New chat"]').exists()).toBe(false)
})

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

it('keeps a closed child under its open parent', async () => {
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
  expect(view.find('[data-chat="sample"] [data-chat="child"]').exists()).toBe(true)
  expect(view.find('[data-chat="child"]').exists()).toBe(true)
  await view.get('[data-chat="child"] > .tree-item-self').trigger('click')
  expect(source.open).toHaveBeenCalledWith('child')
})

it('reveals the current nested chat on reopening and preserves other folds', async () => {
  source.root.value = ['parent', 'other'].map((id) => ({
    kind: 'chat',
    id,
    title: id,
    open: true,
    at: 0,
    children: [{ kind: 'chat', id: `${id}-child`, title: 'Child', open: true, at: 0 }],
  }))
  const first = show()
  for (const id of ['parent', 'other'])
    await first.get(`[data-chat="${id}"] > .tree-item-self .collapse-icon`).trigger('click')
  first.unmount()
  views.pop()
  source.activeId.value = 'parent-child'
  const reopened = show()
  await reopened.vm.$nextTick()
  expect(
    reopened.get('[data-chat="parent-child"] > .tree-item-self').attributes('aria-current')
  ).toBe('true')
  expect(reopened.get('[data-chat="other"] > .tree-item-self').attributes('aria-expanded')).toBe(
    'false'
  )
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
