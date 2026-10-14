import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Menu, Platform } from 'obsidian'
import FileTree from '@/components/nodeWork/FileTree.vue'

afterEach(() => {
  Platform.isPhone = false
  vi.restoreAllMocks()
})

const tree = () =>
  mount(FileTree, {
    attachTo: document.body,
    props: {
      entries: [],
      changes: [{ path: 'a.md', kind: 'modified', stage: 'unstaged' }],
      mode: 'changed-tree',
      git: true,
    } as never,
  })

describe('the file tree’s views on a phone', () => {
  it('are one glyph, the view shown, with the three in its menu', async () => {
    Platform.isPhone = true
    const show = vi.spyOn(Menu.prototype, 'showAtPosition')
    const wrapper = tree()
    const modes = wrapper.findAll('.abele-file-tree__mode')
    expect(modes).toHaveLength(1)
    await modes[0].trigger('click')
    const menu = show.mock.instances[0] as unknown as {
      items: { title: string; checked: boolean | null; handler: (() => void) | null }[]
    }
    expect(menu.items.map((i) => [i.title, !!i.checked])).toEqual([
      ['All files', false],
      ['Changed files in their folders · 1', true],
      ['Only changed files, staged apart · 1', false],
    ])
    menu.items[2].handler!()
    expect(wrapper.emitted('update:mode')).toEqual([['changed']])
    wrapper.unmount()
  })

  it('stay three glyphs on a computer', () => {
    const wrapper = tree()
    expect(wrapper.findAll('.abele-file-tree__mode')).toHaveLength(3)
    wrapper.unmount()
  })
})
