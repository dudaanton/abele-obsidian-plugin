import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TreeItem from '@/components/obsidian/TreeItem.vue'

describe('independent tree disclosure', () => {
  it.each(['blur-first', 'keydown-first'])(
    'discards an edit on Escape with %s delivery',
    async (order) => {
      const row = mount(TreeItem, {
        attachTo: document.body,
        props: { text: 'Original name', renaming: true },
      })
      try {
        await new Promise((resolve) => setTimeout(resolve, 0))
        const editor = row.get('[contenteditable]').element
        editor.textContent = 'Discarded name'
        if (order === 'blur-first') editor.dispatchEvent(new FocusEvent('blur'))
        editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        if (order === 'keydown-first') editor.dispatchEvent(new FocusEvent('blur'))
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(row.emitted('rename')).toBeUndefined()
        expect(row.emitted('rename-cancel')).toEqual([[]])
      } finally {
        row.unmount()
      }
    }
  )
  it.each(['Enter', 'Escape'])(
    'returns focus to the row before %s removes its editor',
    async (key) => {
      const row = mount(TreeItem, {
        attachTo: document.body,
        props: { text: 'Sample name', renaming: true },
      })
      try {
        await new Promise((resolve) => setTimeout(resolve, 0))
        const editor = row.get('[contenteditable]').element
        expect(document.activeElement).toBe(editor)
        editor.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
        expect(document.activeElement).toBe(row.get('.tree-item-self').element)
        expect(row.emitted('rename') ?? []).toEqual(key === 'Enter' ? [['Sample name']] : [])
        expect(row.emitted('rename-cancel') ?? []).toEqual(key === 'Escape' ? [[]] : [])
      } finally {
        row.unmount()
      }
    }
  )
  it('ignores a delayed blur from a removed editor after another rename starts', async () => {
    const row = mount(TreeItem, {
      attachTo: document.body,
      props: { text: 'Sample name', renaming: true },
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      const previous = row.get('[contenteditable]').element
      previous.textContent = 'First name'
      previous.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      await row.setProps({ text: 'First name', renaming: false })
      await row.setProps({ renaming: true })
      await new Promise((resolve) => setTimeout(resolve, 0))
      const current = row.get('[contenteditable]').element
      expect(current).not.toBe(previous)
      previous.dispatchEvent(new FocusEvent('blur'))
      await new Promise<void>((resolve) => queueMicrotask(resolve))
      expect(row.emitted('rename')).toEqual([['First name']])
      expect(row.emitted('rename-cancel')).toBeUndefined()
      current.textContent = 'Second name'
      current.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(row.emitted('rename')).toEqual([['First name'], ['Second name']])
    } finally {
      row.unmount()
    }
  })
  it('waits for its containing sheet spring before exposing the rename editor', async () => {
    const modal = document.createElement('div')
    modal.className = 'modal'
    modal.style.transform = 'translateY(500px)'
    document.body.append(modal)
    const row = mount(TreeItem, {
      attachTo: modal,
      props: { text: 'Sample name', renaming: true },
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(row.find('[contenteditable]').exists()).toBe(false)
      modal.style.transform = ''
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(document.activeElement).toBe(row.get('[contenteditable]').element)
      expect(row.emitted('rename')).toBeUndefined()
    } finally {
      row.unmount()
      modal.remove()
    }
  })
  it('starts renaming when a retained host menu becomes hidden', async () => {
    const menu = document.createElement('div')
    menu.className = 'menu'
    document.body.append(menu)
    const row = mount(TreeItem, {
      attachTo: document.body,
      props: { text: 'Sample name', renaming: true },
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(row.find('[contenteditable]').exists()).toBe(false)
      menu.style.display = 'none'
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(document.activeElement).toBe(row.get('[contenteditable]').element)
      expect(row.emitted('rename')).toBeUndefined()
    } finally {
      row.unmount()
      menu.remove()
    }
  })
  it('waits for a closing host menu before focusing the rename editor', async () => {
    const menu = document.createElement('div')
    menu.className = 'menu'
    document.body.append(menu)
    const row = mount(TreeItem, {
      attachTo: document.body,
      props: { text: 'Sample name', renaming: true },
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(row.find('[contenteditable]').exists()).toBe(false)
      // The phone menu restores focus as its dismissal animation finishes.
      const prior = document.createElement('button')
      menu.append(prior)
      prior.focus()
      menu.remove()
      await new Promise((resolve) => setTimeout(resolve, 0))
      const editor = row.get('[contenteditable]').element
      expect(document.activeElement).toBe(editor)
      expect(document.getSelection()?.toString()).toBe('Sample name')
      expect(row.emitted('rename')).toBeUndefined()
      expect(row.emitted('rename-cancel')).toBeUndefined()
    } finally {
      row.unmount()
      menu.remove()
    }
  })
  it('commits before the host document keymap can consume Enter', async () => {
    const hostKey = (event: KeyboardEvent) => event.stopImmediatePropagation()
    document.addEventListener('keydown', hostKey, true)
    const row = mount(TreeItem, {
      attachTo: document.body,
      props: { text: 'Sample', renaming: true },
    })
    try {
      await new Promise((resolve) => setTimeout(resolve, 0))
      row.get('[contenteditable]').element.textContent = 'Chosen name'
      await row.get('[contenteditable]').trigger('keydown', { key: 'Enter' })
      expect(row.emitted('rename')?.[0]).toEqual(['Chosen name'])
    } finally {
      row.unmount()
      document.removeEventListener('keydown', hostKey, true)
    }
  })
  it('selects the whole name and commits or cancels an in-row rename', async () => {
    const row = mount(TreeItem, {
      attachTo: document.body,
      props: { text: 'Sample name', renaming: true },
      slots: { end: '<time>12:00</time>', actions: '<button>Action</button>' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const editor = row.get('[contenteditable]')
    expect(document.getSelection()?.toString()).toBe('Sample name')
    expect(row.find('.tree-item-flair-outer').exists()).toBe(false)
    editor.element.textContent = 'New name'
    await row.setProps({ text: 'Background title update' })
    expect(editor.element.textContent).toBe('New name')
    await editor.trigger('keydown', { key: 'Enter' })
    expect(row.emitted('rename')?.[0]).toEqual(['New name'])
    await editor.trigger('blur')
    expect(row.emitted('rename')).toHaveLength(1)
    await row.setProps({ renaming: false })
    await row.setProps({ renaming: true })
    await row.get('[contenteditable]').trigger('keydown', { key: 'Escape' })
    await row.get('[contenteditable]').trigger('blur')
    expect(row.emitted('rename-cancel')).toHaveLength(1)
    expect(row.emitted('rename')).toHaveLength(1)
    row.unmount()
  })
  it('folds through the arrow without navigating; the title still navigates', async () => {
    const row = mount(TreeItem, {
      props: { text: 'Sample question', collapsible: true, collapsed: true, foldApart: true },
    })
    await row.find('.collapse-icon').trigger('click')
    expect(row.emitted('toggle')).toHaveLength(1)
    expect(row.emitted('click')).toBeUndefined()
    await row.find('.tree-item-self').trigger('click')
    expect(row.emitted('click')).toHaveLength(1)
    row.unmount()
  })
  it.each(['disabled', 'plain'] as const)('does not fold an inert %s row', async (mode) => {
    const row = mount(TreeItem, {
      props: { text: 'Sample question', collapsible: true, foldApart: true, [mode]: true },
    })
    await row.find('.collapse-icon').trigger('click')
    expect(row.emitted('toggle')).toBeUndefined()
    expect(row.emitted('click')).toBeUndefined()
    row.unmount()
  })
})
