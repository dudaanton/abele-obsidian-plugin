import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSubtaskOf, treeOf } from '@/commands/subtasks'
import { Task } from '@/entities/Task'
import { TasksList } from '@/entities/TasksList'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

const picker = vi.hoisted(() => ({ items: [] as { id: string }[], open: vi.fn() }))
vi.mock('@/components/nodeWork/NodeSuggestModal', () => ({
  NodeSuggestModal: class {
    constructor(_app: unknown, items: { id: string }[]) {
      picker.items = items
    }
    open = picker.open
  },
}))

const task = (name: string, groups: string[] = []) =>
  new Task({ wikilink: `[[Tasks/${name}]]`, oldProps: { groups } })

describe('subtask parent chooser', () => {
  beforeEach(() => {
    useVault([])
    picker.items = []
    picker.open.mockClear()
  })

  it('opens an empty chooser when the store does not yet contain the current task', () => {
    expect(() => makeSubtaskOf(task('Sample pending task'), [])).not.toThrow()
    expect(picker.items).toEqual([])
    expect(picker.open).toHaveBeenCalledOnce()
  })

  it('offers other tasks but excludes self, descendants and existing parents', () => {
    const parent = task('Sample parent')
    const current = task('Sample current', ['[[Sample parent]]'])
    const child = task('Sample child', ['[[Sample current]]'])
    const grandchild = task('Sample grandchild', ['[[Sample child]]'])
    const other = task('Sample alternative')
    makeSubtaskOf(current, [parent, current, child, grandchild, other, other])
    expect(picker.items.map((item) => item.id)).toEqual([other.taskPath])
  })

  it('excludes descendants while the current task has not reached the store yet', () => {
    const current = task('Sample pending task')
    const child = task('Sample child', ['[[Sample pending task]]'])
    const other = task('Sample alternative')
    makeSubtaskOf(current, [child, other])
    expect(picker.items.map((item) => item.id)).toEqual([other.taskPath])
  })

  it('matches list copies to stored tasks by note path', () => {
    const stored = task('Sample shared')
    const copy = task('Sample shared')
    const child = task('Sample child', ['[[Sample shared]]'])
    const { tree, node } = treeOf([copy, child], [stored, child])
    expect(tree.roots).toEqual([node(copy)])
    expect(tree.children.get(node(copy))).toEqual([node(child)])
  })

  it('completing the last subtask also completes its parent', async () => {
    useVault([
      {
        path: 'Tasks/Sample parent.md',
        frontmatter: { type: 'task' },
        content: 'Sample parent body',
      },
    ])
    const parent = task('Sample parent')
    const child = task('Sample final step', ['[[Sample parent]]'])
    child.content = 'Sample task body'
    const list = new TasksList()
    GlobalStore.getInstance().tasksList.value = list
    list.tasks.set(parent.taskPath, parent)
    list.tasks.set(child.taskPath, child)
    try {
      await child.toggle()
      expect(child.completedAt).not.toBeNull()
      expect(parent.completedAt).not.toBeNull()
    } finally {
      list.cleanup()
      GlobalStore.getInstance().tasksList.value = null
    }
  })
})
