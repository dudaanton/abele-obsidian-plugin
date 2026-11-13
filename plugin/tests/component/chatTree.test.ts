import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { shallowRef } from 'vue'
import ChatTreePanel from '@/components/chatTree/ChatTreePanel.vue'
import ChatSwitcher from '@/components/chatTree/ChatSwitcher.vue'
import { CHAT_TREE_SOURCE, chatTreeSource, type ChatTreeSource } from '@/chats/chatTree'
import { useVault } from '../helpers/testEnv'
import ChatToolModes from '@/components/ChatToolModes.vue'
import { Menu, Platform, Scope } from 'obsidian'
import { chatTreeSearchFixture } from '../e2e/helpers/chatTreeSearchFixture'

let source: ChatTreeSource
it.each(['Target', '', 'Sample', 'Sample/Child'])(
  'drags folders only to valid targets: %s',
  async (target) => {
    source.moveFolder = vi.fn()
    source.root.value = [
      {
        kind: 'folder',
        name: 'Sample',
        path: 'Sample',
        children: [{ kind: 'folder', name: 'Child', path: 'Sample/Child', children: [] }],
      },
      { kind: 'folder', name: 'Target', path: 'Target', children: [] },
    ]
    const view = show()
    expect(view.get('[data-path="Sample"]').attributes('draggable')).toBe('true')
    await view.get('[data-path="Sample"]').trigger('dragstart')
    const row = target ? view.get(`[data-path="${target}"]`) : view.get('.abele-chat-tree__list')
    await row.trigger('dragover')
    expect(view.find('.is-being-dragged-over').exists()).toBe(target === 'Target')
    await row.trigger('drop')
    if (target === 'Target') expect(source.moveFolder).toHaveBeenCalledWith('Sample', target)
    else expect(source.moveFolder).not.toHaveBeenCalled()
    expect(source.move).not.toHaveBeenCalled()
  }
)
it('drags a nested folder back to root', async () => {
  source.moveFolder = vi.fn()
  source.root.value = [
    {
      kind: 'folder',
      path: 'Sample',
      name: 'Sample',
      children: [{ kind: 'folder', path: 'Sample/Child', name: 'Child', children: [] }],
    },
  ]
  const view = show()
  await view.get('[data-path="Sample/Child"]').trigger('dragstart')
  await view.get('.abele-chat-tree__list').trigger('drop')
  expect(source.moveFolder).toHaveBeenCalledWith('Sample/Child', '')
})
it.each([true, false])('prevents folder dragging on phone or while renaming: %s', (phone) => {
  Platform.isPhone = phone
  source.moveFolder = vi.fn()
  source.renaming = shallowRef(phone ? null : { kind: 'folder', id: 'Sample' })
  source.root.value = [{ kind: 'folder', path: 'Sample', name: 'Sample', children: [] }]
  const view = show()
  expect(view.get('[data-path="Sample"]').attributes('draggable')).toBe('false')
})
it('starts F2 rename before the host document keymap consumes it', async () => {
  const view = show()
  const hostKey = (event: KeyboardEvent) => event.stopImmediatePropagation()
  document.addEventListener('keydown', hostKey, true)
  try {
    await view.get('[data-chat="sample"] > .tree-item-self').trigger('keydown', { key: 'F2' })
    expect(source.rename).toHaveBeenCalledWith('sample')
  } finally {
    document.removeEventListener('keydown', hostKey, true)
  }
})
it('handles sheet F2 through its scope before the host window keymap opens note rename', async () => {
  const scope = new Scope()
  const unregister = vi.spyOn(scope, 'unregister')
  const noteRename = vi.fn()
  const hostKey = (event: KeyboardEvent) => {
    const result = (
      scope as unknown as {
        handleKey(event: KeyboardEvent, context: { modifiers: string; key: string }): unknown
      }
    ).handleKey(event, { modifiers: '', key: event.key })
    if (result !== false) noteRename()
    event.stopImmediatePropagation()
  }
  window.addEventListener('keydown', hostKey, true)
  const view = show({ keyScope: scope })
  try {
    await view.get('[data-chat="sample"] > .tree-item-self').trigger('keydown', { key: 'F2' })
    expect(source.rename).toHaveBeenCalledWith('sample')
    expect(noteRename).not.toHaveBeenCalled()
    view.unmount()
    expect(unregister).toHaveBeenCalledTimes(1)
  } finally {
    window.removeEventListener('keydown', hostKey, true)
  }
})
it('activates row keys on focus even when the workspace scope is current, then restores it', async () => {
  const workspaceScope = new Scope()
  const sheetScope = new Scope(workspaceScope)
  let active = workspaceScope
  const previous: Scope[] = []
  const keymap = {
    pushScope: vi.fn((scope: Scope) => {
      previous.push(active)
      active = scope
    }),
    popScope: vi.fn(() => {
      active = previous.pop()!
    }),
  }
  Object.assign(useVault([]), { keymap })
  const noteRename = vi.fn()
  const hostKey = (event: KeyboardEvent) => {
    const result = (
      active as unknown as {
        handleKey(event: KeyboardEvent, context: { modifiers: string; key: string }): unknown
      }
    ).handleKey(event, { modifiers: '', key: event.key })
    if (result !== false) noteRename()
    event.stopImmediatePropagation()
  }
  window.addEventListener('keydown', hostKey, true)
  const view = show({ keyScope: sheetScope })
  const outside = document.createElement('button')
  document.body.append(outside)
  try {
    const row = view.get('[data-chat="sample"] > .tree-item-self').element as HTMLElement
    row.focus()
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
    expect(source.rename).toHaveBeenCalledWith('sample')
    expect(noteRename).not.toHaveBeenCalled()
    outside.focus()
    expect(active).toBe(workspaceScope)
    outside.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }))
    expect(noteRename).toHaveBeenCalledTimes(1)
    row.focus()
    view.unmount()
    expect(active).toBe(workspaceScope)
    expect(keymap.popScope).toHaveBeenCalledTimes(2)
  } finally {
    outside.remove()
    window.removeEventListener('keydown', hostKey, true)
  }
})
it('passes F2 outside tree rows to the sheet scope parent', () => {
  const parent = new Scope()
  const scope = new Scope(parent)
  const noteRename = vi.fn(() => false)
  parent.register([], 'F2', noteRename)
  show({ keyScope: scope })
  const result = (
    scope as unknown as {
      handleKey(event: KeyboardEvent, context: { modifiers: string; key: string }): unknown
    }
  ).handleKey(new KeyboardEvent('keydown', { key: 'F2' }), { modifiers: '', key: 'F2' })
  expect(result).toBe(false)
  expect(noteRename).toHaveBeenCalledTimes(1)
  expect(source.rename).not.toHaveBeenCalled()
})
it('cancels the inline edit before the host sheet Escape handler blurs it', async () => {
  Object.assign(source, { renaming: shallowRef({ kind: 'chat', id: 'sample' }) })
  source.cancelRename = vi.fn(() => {
    source.renaming!.value = null
  })
  source.rename = vi.fn(() => {
    source.renaming!.value = null
  })
  const scope = new Scope()
  let active = scope
  Object.assign(useVault([]), {
    keymap: {
      pushScope: (child: Scope) => {
        active = child
      },
      popScope: () => {
        active = scope
      },
    },
  })
  const closeSheet = vi.fn(() => {
    ;(document.activeElement as HTMLElement)?.blur()
    return false
  })
  scope.register([], 'Escape', closeSheet)
  const hostKey = (event: KeyboardEvent) => {
    const result = (
      active as unknown as {
        handleKey(event: KeyboardEvent, context: { modifiers: string; key: string }): unknown
      }
    ).handleKey(event, { modifiers: '', key: event.key })
    if (result === false) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  window.addEventListener('keydown', hostKey, true)
  const view = show({ keyScope: scope })
  try {
    await new Promise((resolve) => setTimeout(resolve, 0))
    const editor = view.get('[contenteditable]').element
    editor.textContent = 'Discarded name'
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(source.cancelRename).toHaveBeenCalledTimes(1)
    expect(source.rename).not.toHaveBeenCalled()
    expect(closeSheet).not.toHaveBeenCalled()
    expect(view.find('[contenteditable]').exists()).toBe(false)
    expect(document.activeElement).toBe(view.get('[data-chat="sample"] > .tree-item-self').element)
  } finally {
    window.removeEventListener('keydown', hostKey, true)
  }
})
it('renames chats and folders in the same row editor, including F2 and empty cancellation', async () => {
  Object.assign(source, { renaming: shallowRef(null) })
  source.cancelRename = () => {
    source.renaming!.value = null
  }
  source.rename = vi.fn((id: string, name?: string) => {
    source.renaming!.value = name === undefined ? { kind: 'chat', id } : null
  })
  source.renameFolder = vi.fn((id: string, name?: string) => {
    source.renaming!.value = name === undefined ? { kind: 'folder', id } : null
  })
  source.root.value.push({ kind: 'folder', name: 'Collection', path: 'Collection', children: [] })
  const view = show()
  await view.get('[data-chat="sample"] > .tree-item-self').trigger('keydown', { key: 'F2' })
  const editor = view.get('[data-chat="sample"] [contenteditable]')
  expect(view.find('[data-chat="sample"] time').exists()).toBe(false)
  editor.element.textContent = 'Chosen name'
  await editor.trigger('keydown', { key: 'Enter' })
  expect(source.rename).toHaveBeenLastCalledWith('sample', 'Chosen name')
  await view.get('[data-path="Collection"] > .tree-item-self').trigger('keydown', { key: 'F2' })
  const folderEditor = view.get('[data-path="Collection"] [contenteditable]')
  folderEditor.element.textContent = '   '
  await folderEditor.trigger('blur')
  expect(source.renameFolder).toHaveBeenCalledTimes(1)
  expect(view.find('[contenteditable]').exists()).toBe(false)
})
it.each(['folder', 'chat'] as const)(
  'starts %s menu rename after native dismissal and cancels a blank name',
  async (kind) => {
    Platform.isPhone = true
    source.renaming = shallowRef(null)
    source.cancelRename = vi.fn(() => {
      source.renaming!.value = null
    })
    source.rename = vi.fn((id: string) => {
      source.renaming!.value = { kind: 'chat', id }
    })
    source.renameFolder = vi.fn((id: string) => {
      source.renaming!.value = { kind: 'folder', id }
    })
    source.root.value = [
      {
        kind: 'folder',
        path: 'Collection',
        name: 'Collection',
        children: [{ kind: 'chat', id: 'nested', title: 'Nested chat', open: true, at: 1 }],
      },
    ]
    const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
    const view = show()
    const overlay = document.createElement('div')
    overlay.className = 'menu'
    document.body.append(overlay)
    try {
      const child = view.get('[data-chat="nested"] > .tree-item-self').element as HTMLElement
      child.focus()
      if (kind === 'folder') await view.get('[aria-label="Collection: more"]').trigger('click')
      else await view.get('[data-chat="nested"] > .tree-item-self').trigger('contextmenu')
      const menu = shown.mock.contexts.at(-1) as Menu
      menu.items.find((item) => item.title === 'Rename…')!.handler!()
      expect(source.renaming.value).toBe(null)
      expect(view.find('[contenteditable]').exists()).toBe(false)
      // Dismissal restores the previous row before delivering the native onHide callback.
      overlay.remove()
      child.focus()
      menu.hide()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const selector =
        kind === 'folder'
          ? '[data-path="Collection"] > .tree-item-self [contenteditable]'
          : '[data-chat="nested"] [contenteditable]'
      const editor = view.get(selector).element
      expect(document.activeElement).toBe(editor)
      expect(document.getSelection()?.toString()).toBe(
        kind === 'folder' ? 'Collection' : 'Nested chat'
      )
      editor.textContent = '   '
      editor.dispatchEvent(new FocusEvent('blur'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(view.find('[contenteditable]').exists()).toBe(false)
      expect(source.cancelRename).toHaveBeenCalledTimes(1)
      expect(kind === 'folder' ? source.renameFolder : source.rename).toHaveBeenCalledTimes(1)
      expect(view.get('[data-path="Collection"] > .tree-item-self').text()).toContain('Collection')
    } finally {
      overlay.remove()
      shown.mockRestore()
    }
  }
)
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
  expect(menu.items.map((item) => item.title).filter(Boolean)).toEqual(
    hidden
      ? ['Show folder', 'New chat', 'New folder', 'Access…', 'Rename…', 'Delete']
      : ['New chat', 'New folder', 'Access…', 'Rename…', label, 'Delete']
  )
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

it.each([true, false])('keeps row actions and search focus appropriate for phone=%s', (phone) => {
  Platform.isPhone = phone
  source.root.value[0].children = [
    { kind: 'chat', id: 'child', title: 'Sample child', open: false, at: 1, nested: 'discussion' },
  ]
  source.root.value.push({ kind: 'folder', path: 'Collection', name: 'Collection', children: [] })
  const view = show()
  const row = view.get('[data-chat="child"] > .tree-item-self')
  expect(row.find('.abele-chat-tree__close-slot').exists()).toBe(false)
  expect(row.find('[aria-label="Close"]').exists()).toBe(false)
  expect(view.find('[data-chat="sample"] [aria-label="Close"]').exists()).toBe(!phone)
  expect(document.activeElement === view.get('input').element).toBe(!phone)
  expect(view.find('[aria-label="New chat in Collection"]').exists()).toBe(!phone)
})

it('opens the closed node chat menu from its phone action without opening the chat', async () => {
  Platform.isPhone = true
  source.root.value = [
    { kind: 'chat', id: 'node:sample', title: 'Sample node', nested: 'node', open: false, at: 1 },
  ]
  const shown = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const view = show()
  try {
    await view.get('.abele-chat-tree__closed > .tree-item-self').trigger('click')
    await view.get('[aria-label="Sample node: more"]').trigger('click')
    expect(view.get('.abele-chat-tree__closed > .tree-item-self').attributes('aria-expanded')).toBe(
      'true'
    )
    expect(shown).toHaveBeenCalledTimes(1)
    const menu = shown.mock.contexts.at(-1) as Menu
    expect(menu.items.map((item) => item.title).filter(Boolean)).toEqual([
      'Open',
      'Move to…',
      'Rename…',
      'Delete',
    ])
    expect(source.open).not.toHaveBeenCalled()
  } finally {
    shown.mockRestore()
  }
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
const show = (props: { keyScope?: Scope } = {}) => {
  const view = mount(ChatTreePanel, { attachTo: document.body, props })
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

it.each([true, false])(
  'finds only the current closed fixture despite an older open fixture on phone=%s',
  async (phone) => {
    Platform.isPhone = phone
    const fixture = chatTreeSearchFixture('sample-run')
    source.root.value = [
      { kind: 'chat', id: 'older', title: 'Sample navigation chat', open: true, at: 1 },
      { kind: 'chat', id: 'current', title: fixture.title, open: false, at: 2 },
    ]
    const view = show()
    const input = view.get('input[type="search"]')
    ;(input.element as HTMLInputElement).value = fixture.query
    await input.trigger('input')
    expect(view.text()).toContain('No matches')
    expect(view.find('[data-chat="older"]').exists()).toBe(false)
    expect(view.find('[data-chat="current"]').exists()).toBe(false)
    await view.get('[aria-label="Search closed chats"]').trigger('click')
    expect(view.find('[data-chat="current"]').exists()).toBe(true)
    expect(view.find('[data-chat="older"]').exists()).toBe(false)
    expect(view.text()).not.toContain('No matches')
  }
)

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
