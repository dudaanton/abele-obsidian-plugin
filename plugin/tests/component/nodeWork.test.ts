/**
 * The node path's screens: the panel lists folders and their copies and picks one, the folder
 * picker filters as one types and opens the highlighted folder, a copy's change opens its diff.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NodePanel from '@/components/nodeWork/NodePanel.vue'
import FolderPicker from '@/components/nodeWork/FolderPicker.vue'
import CopyView from '@/components/nodeWork/CopyView.vue'
import type { FolderSummary, NodeSummary } from '@/components/nodeWork/types'

const node: NodeSummary = { name: 'Sample node', status: 'connected' }
const folder: FolderSummary = {
  id: 'f1',
  name: 'sample-repo',
  path: '~/code/sample-repo',
  git: true,
  copies: [
    { id: 'c1', kind: 'project', branch: 'main', path: '~/code/sample-repo', changed: 2 },
    { id: 'c2', kind: 'worktree', branch: 'feature', path: '~/wt/feature', changed: 0 },
  ],
}

describe('NodePanel', () => {
  it('offers to connect the node found on this computer', async () => {
    const view = mount(NodePanel, { props: { phase: 'found', node } })
    await view.get('button.abele-obsidian-button').trigger('click')
    expect(view.emitted('connect')).toHaveLength(1)
  })

  it('lists copies under their folder, with the count of changed files, and picks one', async () => {
    const view = mount(NodePanel, { props: { phase: 'ready', node, folders: [folder] } })
    const copies = view.findAll('.abele-node-panel__copy')
    expect(copies.map((c) => c.get('.tree-item-inner').text())).toEqual(['main', 'feature'])
    expect(copies[0].get('.tree-item-flair').text()).toBe('2')
    expect(copies[1].find('.tree-item-flair').exists()).toBe(false)
    await copies[1].trigger('click')
    expect(view.emitted('select')).toEqual([['c2']])
  })

  it('says the node is offline by its dot, not by words on the row', () => {
    const view = mount(NodePanel, {
      props: {
        phase: 'ready',
        node: { ...node, status: 'offline', seen: '5 min ago' },
        folders: [folder],
      },
    })
    expect(view.get('.abele-status-dot').classes()).toContain('abele-status-dot_red')
    expect(view.get('.abele-status-dot').attributes('aria-label')).toBe('Offline · seen 5 min ago')
  })
})

describe('FolderPicker', () => {
  const browse = (dir: string) =>
    dir === '~/'
      ? {
          entries: [
            { name: 'code', path: '~/code' },
            { name: 'repo', path: '~/repo', git: { branch: 'main', copies: 1 } },
          ],
        }
      : { error: 'No such folder' }

  it('filters by what is typed and opens the highlighted folder', async () => {
    const view = mount(FolderPicker, { props: { browse } })
    await view.get('input').setValue('~/re')
    expect(view.findAll('.abele-folder-picker__name').map((n) => n.text())).toEqual(['repo'])
    expect(view.get('.abele-folder-picker__preview').text()).toContain('Git repository · main')
    const open = view.findAll('button').find((b) => b.text() === 'Open')!
    await open.trigger('click')
    expect(view.emitted('open')).toEqual([['~/repo']])
  })

  it('says why a folder cannot be listed', async () => {
    const view = mount(FolderPicker, { props: { browse, start: '~/missing/' } })
    expect(view.get('[role="alert"]').text()).toBe('No such folder')
  })
})

describe('CopyView', () => {
  it('opens a change as its diff in place, and closes it on a second press', async () => {
    const view = mount(CopyView, {
      props: {
        node,
        folder,
        copy: folder.copies[0],
        changes: [
          { path: 'src/a.ts', kind: 'modified', added: 1, removed: 1, before: 'a', after: 'b' },
        ],
      },
    })
    const row = view.get('.abele-copy-view__change')
    await row.trigger('click')
    expect(view.find('.abele-diff').exists()).toBe(true)
    await row.trigger('click')
    expect(view.find('.abele-diff').exists()).toBe(false)
  })

  it('shows only files for a folder that is not a repository', () => {
    const view = mount(CopyView, {
      props: {
        node,
        folder: { ...folder, git: false, copies: [] },
        entries: [{ name: 'a.sh', kind: 'file' }],
      },
    })
    expect(view.find('.abele-copy-view__changes').exists()).toBe(false)
    expect(view.find('.abele-copy-view__history').exists()).toBe(false)
    expect(view.get('.abele-copy-view__plain-note').text()).toContain('Not a git repository')
  })
})
