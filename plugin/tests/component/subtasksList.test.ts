/**
 * Subtasks in a list: a task named among another task's groups has it under it, counted on its
 * row and opened from there; a circle of groups stands flat.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { Task } from '@/entities/Task'
import TodoList from '@/components/TodoList.vue'
import TaskView from '@/components/Task.vue'
import { resetSubtasksOpen } from '@/composables/useSubtasksOpen'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
} from '../helpers/fakeIntersectionObserver'
import { useVault } from '../helpers/testEnv'

const task = (name: string, groups: string[] = [], done = false) => {
  const t = new Task({ wikilink: `[[Tasks/${name}]]`, oldProps: { groups } })
  t.loaded = true
  t.title = name
  if (done) t.completedAt = t.createdAt
  return t
}

let wrapper: VueWrapper | undefined
const render = (tasks: Task[]) =>
  (wrapper = mount(TodoList, {
    props: { tasks },
    shallow: true,
    global: { stubs: { ListSectionHeader: false, TaskBranch: false } },
  }) as VueWrapper)

describe('subtasks in a list', () => {
  beforeEach(() => {
    resetFakeIntersectionObservers()
    installFakeIntersectionObserver()
    useVault([])
    resetSubtasksOpen()
  })
  afterEach(() => wrapper?.unmount())

  it('puts subtasks under their parent, counted on its row and opened from it', async () => {
    const parent = task('Sample parent')
    const one = task('Sample first step', ['[[Tasks/Sample parent]]'])
    const two = task('Sample second step', ['[[Sample parent]]'])
    const view = render([parent, one, two])

    let rows = view.findAllComponents(TaskView)
    expect(rows).toHaveLength(1)
    expect(rows[0].props('subtasks')).toEqual({ done: 0, total: 2 })

    rows[0].vm.$emit('toggle-subtasks')
    await view.vm.$nextTick()
    rows = view.findAllComponents(TaskView)
    expect(rows.map((r) => (r.props('task') as Task).title)).toEqual([
      'Sample parent',
      'Sample first step',
      'Sample second step',
    ])
    expect(view.find('.abele-task-branch').exists()).toBe(true)
  })

  it('shows a circle flat and says so on each of its tasks', () => {
    const a = task('Sample one', ['[[Sample two]]'])
    const b = task('Sample two', ['[[Sample one]]'])
    const rows = render([a, b]).findAllComponents(TaskView)
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.props('circular'))).toEqual([['Sample two'], ['Sample one']])
  })
})
