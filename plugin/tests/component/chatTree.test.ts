import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import ChatTreePanel from '@/components/chatTree/ChatTreePanel.vue'
import ChatSwitcher from '@/components/chatTree/ChatSwitcher.vue'
import { CHAT_TREE_SOURCE, chatTreeSource, type ChatTreeSource } from '@/chats/chatTree'
import { useVault } from '../helpers/testEnv'
import ChatToolModes from '@/components/ChatToolModes.vue'
import { Menu, Platform } from 'obsidian'

let source: ChatTreeSource
it.each([
  [false, false, 'Hide folder'],
  [false, true, 'Hide folder and close its chats'],
  [true, false, 'Show folder'],
])('offers one visibility action for hidden=%s open=%s', async (hidden, open, label) => {
  source.hideFolder = vi.fn()
  source.showFolder = vi.fn()
  source.root.value = [
    {
      kind: 'folder',
      path: 'Collection',
      name: 'Collection',
      hidden,
      children: [{ kind: 'chat', id: 'filed', title: 'Filed', open, at: 1 }],
    },
  ]
  const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const view = show()
  if (hidden) await view.get('[aria-label="Search closed chats"]').trigger('click')
  await view.get('[data-path="Collection"] > .tree-item-self').trigger('contextmenu')
  const menu = shown.mock.contexts.at(-1) as Menu
  const visibility = menu.items.filter((item) =>
    ['Hide folder', 'Hide folder and close its chats', 'Show folder'].includes(item.title)
  )
  expect(visibility.map((item) => item.title)).toEqual([label])
  await visibility[0].handler!()
  expect(hidden ? source.showFolder : source.hideFolder).toHaveBeenCalledWith('Collection')
  shown.mockRestore()
})
it('renders open chats above folders and reveals hidden folders with the archive glyph', async () => {
  source.root.value = [
    { kind: 'folder', path: 'Collection', name: 'Collection', hidden: true, children: [] },
    { kind: 'folder', path: 'Visible', name: 'Visible', children: [] },
    { kind: 'chat', id: 'fresh', title: 'Fresh', open: true, at: 100 },
  ]
  const view = show()
  expect(view.find('[data-path="Collection"]').exists()).toBe(false)
  expect(view.findAll('.abele-chat-tree__list > .tree-item')[0].attributes('data-chat')).toBe(
    'fresh'
  )
  await view.get('[aria-label="Search closed chats"]').trigger('click')
  expect(view.get('[data-path="Collection"]').classes()).toContain('abele-chat-tree__folder_hidden')
})
const views: ReturnType<typeof mount>[] = []
it('shows the node as the quiet switcher location', () => {
  const view = mount(ChatSwitcher, { props: { title: 'Sample chat', location: 'Sample node' } })
  views.push(view)
  expect(view.get('.abele-chat-switch__where').text()).toBe('Sample node')
  expect(view.get('.abele-chat-switch__current').attributes('aria-label')).toBe(
    'Sample node / Sample chat'
  )
})
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
  Platform.isPhone = false
  views.forEach((view) => view.unmount())
  views.length = 0
  chatTreeSource.value = null
})

it('reserves an inaccessible close slot on closed phone rows', () => {
  Platform.isPhone = true
  source.root.value[0].children = [
    { kind: 'chat', id: 'child', title: 'Sample child', open: false, at: 1, nested: 'discussion' },
  ]
  const view = show()
  const row = view.get('[data-chat="child"] > .tree-item-self')
  const slot = row.get('.abele-chat-tree__close-slot')
  expect(slot.attributes('aria-hidden')).toBe('true')
  expect(slot.attributes('tabindex')).toBeUndefined()
  expect(row.find('[aria-label="Close"]').exists()).toBe(false)
})

it('keeps the nested folder in the tooltip while giving the header to the chat name', async () => {
  source.root.value = [
    {
      kind: 'folder',
      path: 'sample',
      name: 'Sample folder',
      children: [
        {
          kind: 'chat',
          id: 'parent',
          title: 'Parent',
          open: true,
          at: 1,
          children: [
            { kind: 'chat', id: 'child', title: 'Child', open: true, at: 1, nested: 'discussion' },
          ],
        },
      ],
    },
  ]
  source.activeId.value = 'child'
  const view = mount(ChatSwitcher, { props: { title: 'Child' } })
  views.push(view)
  expect(view.find('.abele-chat-switch__where').exists()).toBe(false)
  expect(view.get('.abele-chat-switch__current').attributes('aria-label')).toBe(
    'Sample folder / Child'
  )
  source.activeId.value = 'parent'
  await view.setProps({ title: 'Parent' })
  expect(view.get('.abele-chat-switch__where').text()).toBe('Sample folder')
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

it('names a new folder in its own row, as the file explorer does', async () => {
  const view = show()
  await view.get('[aria-label="New folder"]').trigger('click')
  expect(view.find('input[aria-label="Folder name"]').exists()).toBe(false)
  const row = view.get('.abele-chat-tree__draft')
  expect(row.classes()).toContain('is-being-renamed')
  const name = row.get('[contenteditable][aria-label="Folder name"]')
  expect(document.activeElement).toBe(name.element)
  name.element.textContent = 'Projects'
  await name.trigger('input')
  await name.trigger('keydown', { key: 'Enter' })
  expect(source.newFolder).toHaveBeenCalledWith('', 'Projects')
  expect(view.find('.abele-chat-tree__draft').exists()).toBe(false)
})

it('keeps a typed folder name on leaving the row and drops it on Esc', async () => {
  const view = show()
  await view.get('[aria-label="New folder"]').trigger('click')
  let name = view.get('.abele-chat-tree__draft [contenteditable]')
  name.element.textContent = 'Kept'
  await name.trigger('input')
  await name.trigger('blur')
  expect(source.newFolder).toHaveBeenCalledWith('', 'Kept')
  vi.mocked(source.newFolder).mockClear()
  await view.get('[aria-label="New folder"]').trigger('click')
  name = view.get('.abele-chat-tree__draft [contenteditable]')
  name.element.textContent = 'Dropped'
  await name.trigger('input')
  await name.trigger('keydown', { key: 'Escape' })
  await name.trigger('blur')
  expect(source.newFolder).not.toHaveBeenCalled()
  expect(view.find('.abele-chat-tree__draft').exists()).toBe(false)
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

it('respects a collapse through activity and reopening until another selection', async () => {
  source.root.value[0].children = [{ kind: 'chat', id: 'child', title: 'Child', open: true, at: 1 }]
  source.activeId.value = 'child'
  const view = show()
  await view.get('[data-chat="sample"] > .tree-item-self .collapse-icon').trigger('click')
  for (const state of [undefined, 'working', 'waiting', 'failed'] as const) {
    source.root.value = source.root.value.map((parent) => ({
      ...parent,
      children: [{ kind: 'chat', id: 'child', title: 'Child', open: true, at: 2, state }],
    }))
    await view.vm.$nextTick()
    expect(view.get('[data-chat="sample"] > .tree-item-self').attributes('aria-expanded')).toBe(
      'false'
    )
  }
  view.unmount()
  views.pop()
  const reopened = show()
  await reopened.vm.$nextTick()
  expect(reopened.get('[data-chat="sample"] > .tree-item-self').attributes('aria-expanded')).toBe(
    'false'
  )
  source.activeId.value = 'sample'
  await reopened.vm.$nextTick()
  source.activeId.value = 'child'
  await reopened.vm.$nextTick()
  expect(reopened.get('[data-chat="sample"] > .tree-item-self').attributes('aria-expanded')).toBe(
    'true'
  )
})

it('persists parent folds when the tree source is recreated', async () => {
  source.root.value[0].children = [{ kind: 'chat', id: 'child', title: 'Child', open: true, at: 1 }]
  const view = show()
  await view.get('[data-chat="sample"] > .tree-item-self .collapse-icon').trigger('click')
  view.unmount()
  views.pop()
  source = { ...source, activeId: shallowRef('sample') }
  chatTreeSource.value = source
  const reopened = show()
  expect(reopened.get('[data-chat="sample"] > .tree-item-self').attributes('aria-expanded')).toBe(
    'false'
  )
})

it('keeps a restored active descendant folded and reveals a later selection after indexing', async () => {
  const { GlobalStore } = await import('@/stores/GlobalStore')
  GlobalStore.getInstance().app.saveLocalStorage('abele-chat-tree-folds', ['chat:sample'])
  const version = shallowRef(0)
  source = { ...source, selectionVersion: version }
  chatTreeSource.value = source
  source.activeId.value = 'child'
  const tree = [
    {
      kind: 'chat' as const,
      id: 'sample',
      title: 'Parent',
      open: true,
      at: 1,
      children: [{ kind: 'chat' as const, id: 'child', title: 'Child', open: true, at: 1 }],
    },
  ]
  source.root.value = tree
  const view = show()
  expect(view.get('[data-chat="sample"] > .tree-item-self').attributes('aria-expanded')).toBe(
    'false'
  )
  source.root.value = []
  version.value = 1
  await view.vm.$nextTick()
  source.root.value = tree
  await view.vm.$nextTick()
  expect(view.get('[data-chat="sample"] > .tree-item-self').attributes('aria-expanded')).toBe(
    'true'
  )
})

it('keeps folds when a parent is saved and reopened with a new tab id', async () => {
  source.root.value[0].children = [{ kind: 'chat', id: 'child', title: 'Child', open: true, at: 1 }]
  const view = show()
  await view.get('[data-chat="sample"] > .tree-item-self .collapse-icon').trigger('click')
  source.root.value = source.root.value.map((chat) => ({ ...chat, foldId: 'Sample/parent.abchat' }))
  await view.vm.$nextTick()
  source.root.value = source.root.value.map((chat) => ({ ...chat, id: 'reopened' }))
  await view.vm.$nextTick()
  expect(view.get('[data-chat="reopened"] > .tree-item-self').attributes('aria-expanded')).toBe(
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

it('asks before deleting a nonempty logical folder and respects cancellation', async () => {
  const dialogs = await import('@/components/obsidian/dialogs')
  const confirm = vi.spyOn(dialogs, 'confirmDialog').mockResolvedValue(false)
  const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  source.root.value = [
    {
      kind: 'folder',
      path: 'Projects',
      name: 'Projects',
      canDelete: true,
      children: [{ kind: 'chat', id: 'sample', title: 'Sample chat', open: true, at: 1 }],
    },
  ]
  const view = show()
  try {
    await view.get('[aria-label="Projects: more"]').trigger('click')
    const menu = shown.mock.contexts.at(-1) as Menu
    await menu.items.find((item) => item.title === 'Delete')!.handler!()
    expect(confirm).toHaveBeenCalled()
    expect(source.deleteFolder).not.toHaveBeenCalled()
    confirm.mockResolvedValue(true)
    await menu.items.find((item) => item.title === 'Delete')!.handler!()
    expect(source.deleteFolder).toHaveBeenCalledWith('Projects')
  } finally {
    confirm.mockRestore()
    shown.mockRestore()
  }
})
