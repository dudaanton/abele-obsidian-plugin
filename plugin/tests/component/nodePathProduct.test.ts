import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, shallowRef } from 'vue'
import NodePathSidebar from '@/components/nodeWork/NodePathSidebar.vue'
import PairDialog from '@/components/nodeWork/PairDialog.vue'
import FileTree from '@/components/nodeWork/FileTree.vue'
import HistoryView from '@/components/nodeWork/HistoryView.vue'

const parse = () => ({
  name: 'Sample node',
  host: 'sample.ts.net',
  port: 443,
  fingerprint: 'a'.repeat(64),
  expires: 'Today, 12:00',
})
describe('product node sidebar', () => {
  it('composes the folder and file trees and retains their content with a disconnected dot', async () => {
    const model = {
      folders: shallowRef([
        {
          id: 'project',
          name: 'Sample',
          path: '/sample',
          git: true,
          copies: [{ id: 'tree', kind: 'project', branch: 'trunk', path: '/sample', changed: 1 }],
        },
      ]),
      selected: ref('tree'),
      current: ref({ id: 'tree' }),
      selectedChat: ref(''),
      currentFolder: ref({ name: 'Sample', git: true }),
      currentCopy: ref({ branch: 'trunk' }),
      entries: shallowRef([]),
      changes: shallowRef([
        {
          path: 'sample.ts',
          kind: 'modified',
          stage: 'partly',
          before: '',
          after: '',
          added: 0,
          removed: 0,
        },
      ]),
      mode: ref('changed'),
      error: ref(''),
      busy: ref(false),
      capabilities: shallowRef<string[]>([]),
    }
    const view = mount(NodePathSidebar, {
      props: {
        model: model as never,
        phase: 'ready',
        node: { name: 'Sample node', status: 'offline', seen: 'Today, 12:00' },
      },
    })
    expect(view.find('.abele-folder-tree_stale').exists()).toBe(true)
    expect(view.find('.abele-file-tree_stale').exists()).toBe(true)
    expect(view.text()).toContain('sample.ts')
    expect(view.text()).toContain('As of Today, 12:00')
    await view.find('.abele-node-panel__node-menu').trigger('click')
    expect(view.emitted('node-menu')).toHaveLength(1)
    view.unmount()
  })
  it('keeps an expanded file directory expanded across a live tree refresh', async () => {
    const entries = [
      {
        path: 'src',
        name: 'src',
        kind: 'folder' as const,
        children: [{ path: 'src/sample.ts', name: 'sample.ts', kind: 'file' as const }],
      },
    ]
    const view = mount(FileTree, { props: { entries, changes: [], mode: 'all' } })
    await view.find('.tree-item-self').trigger('click')
    expect(view.text()).toContain('sample.ts')
    await view.setProps({ entries: structuredClone(entries) })
    expect(view.text()).toContain('sample.ts')
    view.unmount()
  })
  it('opens a partly-staged file with the group stage, not the sidebar global mode', async () => {
    const view = mount(FileTree, {
      props: {
        entries: [],
        changes: [
          {
            path: 'sample.ts',
            kind: 'modified',
            stage: 'partly',
            before: '',
            after: '',
            added: 0,
            removed: 0,
          },
        ],
        mode: 'changed',
      },
    })
    const matches = view.findAll('.tree-item-self').filter((r) => r.text().includes('sample.ts'))
    await matches[1].trigger('click')
    expect(view.emitted('open')?.[0]).toEqual(['sample.ts', 'staged'])
    view.unmount()
  })
})
describe('unknown history divergence', () => {
  it('does not turn unavailable ahead and behind counts into zero', () => {
    const view = mount(HistoryView, {
      props: {
        commits: [],
        copy: { id: 'tree', kind: 'worktree', branch: 'topic', path: '/sample/topic', changed: 0 },
      },
    })
    expect(view.find('.abele-history__drift').text()).toContain('?')
    expect(view.find('.abele-history__drift').text()).not.toContain('0')
    view.unmount()
  })
})
describe('pairing endpoint form', () => {
  it('keeps the pin read-only and emits the entered endpoint, rejects non-integral ports', async () => {
    const view = mount(PairDialog, {
      props: { step: 'paste', parse, device: 'Sample device', initial: 'sample code' },
    })
    expect(view.findAll('.setting-item').map((r) => r.find('.setting-item-name').text())).toEqual([
      'Address',
      'Port',
    ])
    await view.find('input[aria-label="Address"]').setValue('alternate.ts.net')
    await view.find('input[aria-label="Port"]').setValue('1e2')
    expect(view.find('button.mod-cta').attributes('disabled')).toBeDefined()
    await view.find('input[aria-label="Port"]').setValue('8443')
    await view.find('button.mod-cta').trigger('click')
    expect(view.emitted('connect')?.[0]).toEqual([
      'sample code',
      { host: 'alternate.ts.net', port: 8443 },
    ])
    expect(view.find('.abele-pair__fields input').exists()).toBe(false)
    view.unmount()
  })
  it('does not carry key-change confirmation into a different pasted code', async () => {
    const view = mount(PairDialog, {
      props: {
        step: 'paste',
        parse: vi.fn(parse),
        device: 'Sample device',
        initial: 'first code',
        keyChanged: true,
      },
    })
    await view.find('.checkbox-container').trigger('click')
    expect(view.find('button.mod-cta').attributes('disabled')).toBeUndefined()
    await view.find('textarea').setValue('second code')
    await flushPromises()
    expect(view.find('button.mod-cta').attributes('disabled')).toBeDefined()
    view.unmount()
  })
})
