import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import FileTreeLevel from '@/components/nodeWork/FileTreeLevel.vue'

describe('names in the node’s file tree', () => {
  it('carry full long file and folder paths in row labels, expanded or collapsed', async () => {
    const folder = 'docs/a-very-long-sample-folder-name-for-the-tree'
    const file = `${folder}/a-very-long-sample-file-name-for-the-tree.md`
    const wrapper = mount(FileTreeLevel, {
      props: {
        entries: [
          {
            path: folder,
            name: 'a-very-long-sample-folder-name-for-the-tree',
            kind: 'folder',
            children: [
              {
                path: file,
                name: 'a-very-long-sample-file-name-for-the-tree.md',
                kind: 'file',
              },
            ],
          },
        ],
        folded: new Set<string>(),
      },
    })
    const rows = wrapper.findAll('.tree-item-self')
    expect(rows.map((r) => r.attributes('aria-label'))).toEqual([folder, file])
    await wrapper.setProps({ folded: new Set([folder]) })
    const collapsedRows = wrapper.findAll('.tree-item-self')
    expect(collapsedRows).toHaveLength(1)
    expect(collapsedRows[0].attributes('aria-label')).toBe(folder)
    wrapper.unmount()
  })

  it('keep to one line, cut short, instead of breaking anywhere', () => {
    const source = readFileSync('src/components/nodeWork/FileTree.vue', 'utf8')
    const rule = source.match(/\.abele-file-tree \.abele-tree-item__text \{([^}]+)\}/)?.[1] ?? ''
    expect(rule).toContain('white-space: nowrap')
    expect(rule).toContain('text-overflow: ellipsis')
  })

  it('preserve the single-line name and badge layout on a phone', () => {
    const source = readFileSync('src/components/nodeWork/FileTree.vue', 'utf8')
    const phoneRules = [...source.matchAll(/body\.is-phone[^{}]+\{([^}]+)\}/g)]
      .map((match) => match[1])
      .join('\n')
    expect(phoneRules).not.toMatch(/white-space:\s*normal/)
    expect(phoneRules).not.toMatch(/flex-wrap:\s*wrap/)
    expect(phoneRules).not.toMatch(/flex-basis:\s*100%/)
  })
})
