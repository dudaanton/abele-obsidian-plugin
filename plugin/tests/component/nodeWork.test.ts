/**
 * The node path's screens: the panel lists folders and their copies and picks one, the folder
 * picker filters as one types and opens the highlighted folder, a copy's change opens its diff.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NodePanel from '@/components/nodeWork/NodePanel.vue'
import FolderPicker from '@/components/nodeWork/FolderPicker.vue'
import FolderTree from '@/components/nodeWork/FolderTree.vue'
import FileTree from '@/components/nodeWork/FileTree.vue'
import type { FileChange, FolderSummary, NodeSummary } from '@/components/nodeWork/types'

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

  it('says the node is offline by its dot, not by words on the row', () => {
    const view = mount(NodePanel, {
      props: { phase: 'ready', node: { ...node, status: 'offline', seen: '5 min ago' } },
    })
    expect(view.get('.abele-status-dot').classes()).toContain('abele-status-dot_red')
    expect(view.get('.abele-status-dot').attributes('aria-label')).toBe(
      'Offline · last heard 5 min ago'
    )
  })
})

describe('FolderTree', () => {
  it('lists worktrees under their folder, with the count of changed files, and picks one', async () => {
    const view = mount(FolderTree, { props: { folders: [folder] } })
    const rows = view.findAll('.abele-tree-item__self').slice(1)
    expect(rows.map((r) => r.get('.abele-tree-item__text').text())).toEqual(['main', 'feature'])
    expect(rows[0].get('.abele-copy-codes__count').text()).toBe('2')
    // Empty counts reserve the same column as populated counts.
    expect(rows[1].get('.abele-copy-codes__count').text()).toBe('')
    await rows[1].trigger('click')
    expect(view.emitted('select')).toEqual([['c2']])
  })
})

describe('FileTree', () => {
  it('does not call a reading folder empty and retries failed reads', async () => {
    const view = mount(FileTree, {
      props: { entries: [], changes: [], mode: 'all', progress: { state: 'reading' } },
    })
    expect(view.text()).toContain('Reading the files')
    expect(view.text()).not.toContain('The folder is empty.')
    await view.setProps({ progress: { state: 'failed', error: 'Sample read error' } })
    expect(view.text()).toContain("Couldn't read the files.")
    await view.get('[aria-label="Try again"]').trigger('click')
    expect(view.emitted('retry')).toHaveLength(1)
  })

  const change = (path: string, stage: FileChange['stage']): FileChange => ({
    path,
    kind: 'modified',
    stage,
    added: 1,
    removed: 1,
    before: 'a',
    after: 'b',
  })
  it('splits changed files into unstaged and staged, a partly staged one in both', () => {
    const view = mount(FileTree, {
      props: {
        entries: [],
        mode: 'changed',
        changes: [change('a.ts', 'unstaged'), change('b.ts', 'staged'), change('c.ts', 'partly')],
      },
    })
    const groups = view.findAll('.abele-file-tree__group')
    expect(groups.map((g) => g.get('.tree-item-flair').text())).toEqual(['2', '2'])
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
      : dir === '~/repo/'
        ? { entries: [] }
        : { error: 'No such folder' }

  it('highlights nothing under the pointer: the row is only pressed', async () => {
    const view = mount(FolderPicker, { props: { browse, start: '~/' } })
    const before = view.get('.abele-folder-picker__preview').text()
    await view.findAll('.abele-folder-picker__row')[1].trigger('pointerenter')
    expect(view.get('.abele-folder-picker__preview').text()).toBe(before)
  })

  it('filters by what is typed, goes into a folder on a press of its row, and opens the folder it is in', async () => {
    const view = mount(FolderPicker, { props: { browse } })
    await view.get('input').setValue('~/re')
    expect(view.findAll('.abele-folder-picker__name').map((n) => n.text())).toEqual(['repo'])
    await view.get('.abele-folder-picker__row').trigger('click')
    expect((view.get('input').element as HTMLInputElement).value).toBe('~/repo/')
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

describe('FolderPicker, new folder', () => {
  it('offers a name no folder has as a new folder, and makes it', async () => {
    const view = mount(FolderPicker, {
      props: { browse: () => ({ entries: [{ name: 'code', path: '~/code' }] }) },
    })
    await view.get('input').setValue('~/tool')
    expect(view.get('.abele-folder-picker__row_create').text()).toContain('tool')
    await view.get('.abele-folder-picker__row_create').trigger('click')
    expect(view.emitted('create')).toEqual([['~/tool']])
  })
})
