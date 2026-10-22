import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import FileTreeLevel from '@/components/nodeWork/FileTreeLevel.vue'

describe('names in the node’s file tree', () => {
  it('carry the whole path in the row’s tooltip', () => {
    const wrapper = mount(FileTreeLevel, {
      props: {
        entries: [
          {
            path: 'docs/guide',
            name: 'docs/guide',
            kind: 'folder',
            children: [
              {
                path: 'docs/guide/a-very-long-sample-file-name-for-the-tree.md',
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
    expect(rows.map((r) => r.attributes('aria-label'))).toEqual([
      'docs/guide',
      'docs/guide/a-very-long-sample-file-name-for-the-tree.md',
    ])
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
