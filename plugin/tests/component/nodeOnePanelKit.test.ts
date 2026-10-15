/**
 * The node panel's own pieces for one place: the place row, the modes under the panel's header,
 * the branch's codes, the commit field and the branch's next step.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import NodePlace from '@/components/nodeWork/NodePlace.vue'
import NodeModes from '@/components/nodeWork/NodeModes.vue'
import BranchCodes from '@/components/nodeWork/BranchCodes.vue'
import CommitBox from '@/components/nodeWork/CommitBox.vue'
import FileTree from '@/components/nodeWork/FileTree.vue'
import { nextStep } from '@/components/nodeWork/branchStep'
import type { BranchState, FileChange } from '@/components/nodeWork/types'

const change = (path: string, stage: FileChange['stage']): FileChange => ({
  path,
  kind: 'modified',
  stage,
  added: 1,
  removed: 0,
  before: '',
  after: '',
})
const state = (over: Partial<BranchState> = {}): BranchState => ({
  base: 'main',
  ahead: 0,
  behind: 0,
  unpushed: 0,
  upstream: 'origin/sample-branch',
  ...over,
})

describe('NodePlace', () => {
  it('names the branch with its folder under it, and opens the search on a press', async () => {
    const view = mount(NodePlace, {
      props: { node: 'Sample node', folder: 'sample-app', branch: 'sample-branch' },
    })
    expect(view.get('.abele-node-place__name').text()).toBe('sample-branch')
    expect(view.get('.abele-node-place__where').text()).toBe('sample-app')
    await view.get('.abele-node-place__row').trigger('click')
    expect(view.emitted('pick')).toHaveLength(1)
  })

  it('asks for a folder when none is open', () => {
    const view = mount(NodePlace, { props: { node: 'Sample node' } })
    expect(view.get('.abele-node-place__none').text()).toBe('Choose a folder')
  })
})

describe('NodeModes', () => {
  it('has files only for a folder without git', () => {
    const view = mount(NodeModes, { props: { mode: 'files', git: false, pulls: false } })
    expect(view.findAll('[role="tab"]')).toHaveLength(1)
  })

  it('counts the changes, switches mode and leaves out pull requests without a service', async () => {
    const view = mount(NodeModes, {
      props: { mode: 'files', git: true, pulls: false, changes: 3 },
    })
    const tabs = view.findAll('[role="tab"]')
    expect(tabs).toHaveLength(3)
    expect(tabs[1].text()).toContain('3')
    await tabs[2].trigger('click')
    expect(view.emitted('update:mode')?.[0]).toEqual(['history'])
  })

  it('says what the changes are counted against and stops comparing', async () => {
    const view = mount(NodeModes, {
      props: { mode: 'changes', git: true, pulls: false, against: 'main' },
    })
    expect(view.get('.abele-node-modes__against-name').text()).toBe('vs main')
    await view.get('.abele-node-modes__against [aria-label^="Stop comparing"]').trigger('click')
    expect(view.emitted('stop-compare')).toHaveLength(1)
  })
})

describe('BranchCodes', () => {
  it('says the base and how far ahead and behind, in codes', () => {
    const view = mount(BranchCodes, {
      props: { state: state({ ahead: 2, behind: 1 }), branch: 'sample-branch', size: 'panel' },
    })
    expect(view.get('.abele-branch-codes__base').text()).toBe('main')
    expect(view.get('.abele-branch-codes__drift').text()).toBe('21')
  })

  it('offers to choose a base when none was found', async () => {
    const view = mount(BranchCodes, { props: { state: state({ base: null }), branch: 'x' } })
    await view.get('.abele-branch-codes__base_none').trigger('click')
    expect(view.emitted('choose-base')).toHaveLength(1)
  })
})

describe('CommitBox', () => {
  it('keeps a message of several lines and commits it whole on Cmd+Enter', async () => {
    const view = mount(CommitBox, { props: { staged: 2 } })
    const field = view.get('textarea')
    await field.setValue('Rank matches by distance\n\nCloser ones come first.')
    await field.trigger('keydown', { key: 'Enter', metaKey: true })
    expect(view.emitted('commit')?.[0]).toEqual([
      'Rank matches by distance\n\nCloser ones come first.',
    ])
  })

  it('does not commit while a file is in conflict', async () => {
    const view = mount(CommitBox, { props: { staged: 1, conflicts: 1 } })
    await view.get('textarea').setValue('Something')
    await view.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true })
    expect(view.emitted('commit')).toBeUndefined()
  })
})

describe('FileTree with staging', () => {
  it('puts each group in its own tree and stages a file from its row', async () => {
    const view = mount(FileTree, {
      props: {
        entries: [],
        mode: 'changed-tree',
        actions: true,
        changes: [change('src/sample/a.ts', 'unstaged'), change('src/sample/b.ts', 'staged')],
      },
    })
    const groups = view.findAll('.abele-file-tree__group')
    expect(groups.map((g) => g.get('.tree-item-flair').text())).toEqual(['1', '1'])
    const row = view.findAll('.tree-item-self').find((r) => r.text().includes('a.ts'))!
    await row.get('[aria-label="Stage"]').trigger('click')
    expect(view.emitted('stage')?.[0]).toEqual(['src/sample/a.ts'])
    expect(view.emitted('open')).toBeUndefined()
  })

  it('lists what the branch committed as its own group, against its base', () => {
    const view = mount(FileTree, {
      props: {
        entries: [],
        mode: 'changed-tree',
        actions: true,
        base: 'main',
        changes: [],
        branchChanges: [change('src/sample/c.ts', undefined)],
      },
    })
    const groups = view.findAll('.abele-file-tree__group')
    expect(groups).toHaveLength(1)
    expect(groups[0].text()).toContain('Committed')
  })
})

describe('nextStep', () => {
  const copy = { kind: 'worktree' as const, branch: 'sample-branch' }
  it('publishes a branch never pushed, then pushes, then updates, then opens a pull request', () => {
    expect(nextStep(state({ upstream: undefined, ahead: 1 }), copy)?.id).toBe('publish')
    expect(nextStep(state({ ahead: 1, unpushed: 1 }), copy)?.id).toBe('push')
    expect(nextStep(state({ behind: 2 }), copy)?.id).toBe('update')
    expect(nextStep(state({ ahead: 1 }), copy)?.id).toBe('create-pr')
    expect(nextStep(state(), copy)).toBeNull()
  })
  it('has no step while a rebase is stopped', () => {
    expect(
      nextStep(state({ behind: 1, stopped: { kind: 'rebase', onto: 'main', conflicts: 1 } }), copy)
    ).toBeNull()
  })
})

describe('UpdateDialog as the node offers it', () => {
  it('offers only the rebase, and waits for uncommitted files to be committed or discarded', async () => {
    const { default: UpdateDialog } = await import('@/components/nodeWork/UpdateDialog.vue')
    const view = mount(UpdateDialog, {
      props: {
        branch: 'sample-branch',
        base: 'main',
        behind: 2,
        dirty: 1,
        pushed: true,
        ways: ['rebase'],
        clean: true,
        force: false,
      },
    })
    expect(view.find('select').exists()).toBe(false)
    expect(view.text()).toContain('Commit or discard the 1 changed file first')
    expect(view.text()).toContain('pushing it is refused until that copy is replaced')
    const update = view.findAll('button').find((b) => b.text() === 'Update')!
    expect(update.attributes('disabled')).toBeDefined()
  })
})
