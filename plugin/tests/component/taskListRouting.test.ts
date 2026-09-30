import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import dayjs from 'dayjs'
import TodoSidebar from '@/components/TodoSidebar.vue'
import TimelineSidebar from '@/components/TimelineSidebar.vue'
import TodoList from '@/components/TodoList.vue'
import Timeline from '@/components/Timeline.vue'
import TaskCard from '@/components/Task.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { Task } from '@/entities/Task'
import { TasksList } from '@/entities/TasksList'
import { GlobalStore } from '@/stores/GlobalStore'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { configureAbele, useVault } from '../helpers/testEnv'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'

vi.mock('@/composables/useDate', () => ({ useDate: () => ({ now: ref(dayjs('2028-02-01')) }) }))
vi.mock('@/composables/useCalendarDays', () => ({ useCalendarDays: () => ref(new Map()) }))
let view: VueWrapper | undefined
beforeEach(() => {
  useVault([])
  configureAbele()
  installFakeIntersectionObserver()
})
afterEach(() => {
  view?.unmount()
  view = undefined
  GlobalStore.getInstance().tasksList.value?.cleanup()
  GlobalStore.getInstance().tasksList.value = null
  VaultWatcherWrapper.destroy()
})
const task = (name: string, date?: string, done = false) => {
  const value = new Task({
    id: name,
    wikilink: `[[Tasks/${name}]]`,
    date: date ? dayjs(date) : undefined,
    completedAt: done ? dayjs('2028-02-01') : undefined,
  })
  value.loaded = true
  value.title = name
  return value
}
const rendered = () => view.findAllComponents(TaskCard).map((card) => card.props('task').title)

describe('routing tasks to sidebars and lists', () => {
  it.each([TodoSidebar, TimelineSidebar])(
    'starts empty before the global index exists',
    (component) => {
      view = mount(component, { shallow: true })
      expect(
        view.findComponent(component === TodoSidebar ? TodoList : Timeline).props('tasks')
      ).toEqual([])
    }
  )

  it('routes only found undated tasks to Todo, dated tasks to Timeline, retaining completed for list toggles', () => {
    const list = new TasksList()
    const noDate = task('Undated')
    const dated = task('Event', '2028-02-01')
    const dueOnly = task('Deadline')
    dueOnly.due = dayjs('2028-02-02')
    const completed = task('Completed', undefined, true)
    const missing = task('Missing')
    missing.taskNotFound = true
    for (const value of [noDate, dated, dueOnly, completed, missing])
      list.tasks.set(value.taskPath, value)
    GlobalStore.getInstance().tasksList.value = list
    view = mount(TodoSidebar, { shallow: true })
    expect(
      view
        .findComponent(TodoList)
        .props('tasks')
        .map((t: Task) => t.title)
    ).toEqual(['Undated', 'Completed'])
    view.unmount()
    view = mount(TimelineSidebar, { shallow: true })
    expect(
      view
        .findComponent(Timeline)
        .props('tasks')
        .map((t: Task) => t.title)
    ).toEqual(['Deadline', 'Event'])
  })

  it('orders timed tasks before untimed on one day regardless of priority; completed/missing stay hidden', async () => {
    const untimed = task('Untimed', '2028-02-01')
    untimed.priority = 'high'
    const late = task('Late', '2028-02-01 17:00')
    late.dateTime = late.date
    const early = task('Early', '2028-02-01 08:00')
    early.dateTime = early.date
    const missing = task('Missing', '2028-02-01')
    missing.taskNotFound = true
    const done = task('Done', '2028-02-01', true)
    view = mount(Timeline, {
      props: { tasks: [untimed, late, missing, early, done] },
      shallow: true,
    })
    expect(rendered()).toEqual(['Early', 'Late', 'Untimed'])
    expect(view.findAllComponents(TaskCard).every((card) => card.props('atTimeline'))).toBe(true)
    await view
      .findAllComponents(Icon)
      .find((icon) => icon.props('textRight') === 'Show completed')!
      .trigger('click')
    await flushPromises()
    expect(rendered()).toEqual(['Early', 'Late', 'Untimed', 'Done'])
  })

  it('Todo hides completed by default and updates its empty message after filtering them', async () => {
    view = mount(TodoList, { props: { tasks: [task('Done', undefined, true)] }, shallow: true })
    expect(rendered()).toEqual([])
    expect(view.text()).toContain('No tasks to show.')
    await view
      .findAllComponents(Icon)
      .find((icon) => icon.props('textRight') === 'Show completed')!
      .trigger('click')
    expect(rendered()).toEqual(['Done'])
    expect(view.text()).not.toContain('No tasks to show.')
  })
})
