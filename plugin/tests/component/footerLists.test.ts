/**
 * The footer lists must not mount a component per relation.
 *
 * A note attached to a wide group gathers a relation per group member. Measured on a
 * 43,346-file vault, one such note produced 100,984 DOM nodes and blocked the main thread
 * for 4.5 seconds, of which the underlying data cost 477ms — the rest was rendering.
 * `TransactionsList` and `TimeEntryListView` already paged; these four did not.
 *
 * The assertions are about how many items reach the DOM and in what order, so child
 * components are stubbed: what is under test is each list's own windowing, not what a task
 * or a log looks like.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Menu, type MenuItem } from 'obsidian'
import { mount, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import { Note } from '@/entities/Note'
import { Log } from '@/entities/Log'
import { Task } from '@/entities/Task'
import NotesList from '@/components/NotesList.vue'
import LogsList from '@/components/LogsList.vue'
import TodoList from '@/components/TodoList.vue'
import Timeline from '@/components/Timeline.vue'
import TaskCard from '@/components/Task.vue'
import ObsidianIcon from '@/components/obsidian/Icon.vue'
import Card from '@/components/obsidian/Card.vue'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'
import { useVault, configureAbele } from '../helpers/testEnv'

/** How many entries each list must gather before paging is worth anything. */
const LARGE = 500

const NOTES_PAGE_SIZE = 50
const DEFAULT_PAGE_SIZE = 20

function buildNotes(count: number): Note[] {
  return Array.from({ length: count }, (_, i) => {
    const note = new Note(`Notes/Note ${i}.md`)
    // Descending created dates, so index order and sorted order coincide.
    note.createdAt = dayjs('2026-01-01').subtract(i, 'day')
    note.updatedAt = dayjs('2026-06-01').subtract(i, 'day')
    return note
  })
}

function buildLogs(count: number): Log[] {
  return Array.from({ length: count }, (_, i) => {
    const log = new Log(`Logs/Log ${i}.md`, 'Notes/Group.md')
    log.createdAt = dayjs('2026-01-01').subtract(i, 'day')
    return log
  })
}

function buildTasks(count: number): Task[] {
  return Array.from({ length: count }, (_, i) => {
    const task = new Task({ wikilink: `[[Tasks/Task ${i}]]` })
    task.loaded = true
    task.title = `Task ${i}`
    return task
  })
}

/** Tasks that each occupy exactly one, distinct day — one date block per task. */
function buildDatedTasks(count: number): Task[] {
  return buildTasks(count).map((task, i) => {
    task.date = dayjs('2026-01-01').add(i, 'day')
    return task
  })
}

let wrapper: VueWrapper | null = null

function render(component: unknown, props: Record<string, unknown>): VueWrapper {
  wrapper = mount(component as never, { props, shallow: true }) as VueWrapper
  return wrapper
}

describe('footer lists — paging', () => {
  beforeEach(() => {
    resetFakeIntersectionObservers()
    installFakeIntersectionObserver()
    // Entities reach the vault through GlobalStore even when only their in-memory fields are
    // read; an empty vault keeps that from throwing.
    useVault([])
    configureAbele()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  describe('NotesList', () => {
    it('renders one page instead of every note', () => {
      const view = render(NotesList, { notes: buildNotes(LARGE) })

      expect(view.findAll('.abele-notes-list__item')).toHaveLength(NOTES_PAGE_SIZE)
    })

    it('renders the same notes the unpaged list would have shown first', () => {
      const notes = buildNotes(LARGE)
      const view = render(NotesList, { notes })

      const expected = [...notes]
        .sort((a, b) => (b.createdAt?.unix() ?? 0) - (a.createdAt?.unix() ?? 0))
        .slice(0, NOTES_PAGE_SIZE)
        .map((note) => note.name)

      const rendered = view.findAllComponents(Card).map((card) => card.props('title') as string)
      expect(rendered).toEqual(expected)
    })

    it('reveals another page when the sentinel scrolls into view', async () => {
      const view = render(NotesList, { notes: buildNotes(LARGE) })
      // @vueuse/core registers the observer in a post-flush watcher, so the sentinel is not
      // being observed until the mount flush has drained.
      await view.vm.$nextTick()

      const sentinel = view.find('.abele-notes-list__sentinel')
      expect(sentinel.exists()).toBe(true)
      expect(scrollIntoView(sentinel.element)).toBe(1)

      await view.vm.$nextTick()
      expect(view.findAll('.abele-notes-list__item')).toHaveLength(NOTES_PAGE_SIZE * 2)
    })

    it('drops the sentinel once everything is shown', () => {
      const view = render(NotesList, { notes: buildNotes(10) })

      expect(view.findAll('.abele-notes-list__item')).toHaveLength(10)
      expect(view.find('.abele-notes-list__sentinel').exists()).toBe(false)
    })
  })

  describe('LogsList', () => {
    it('renders one page instead of every log', () => {
      const view = render(LogsList, { logs: buildLogs(LARGE) })

      expect(view.findAll('.abele-logs-list__note')).toHaveLength(DEFAULT_PAGE_SIZE)
    })

    it('reveals another page when the sentinel scrolls into view', async () => {
      const view = render(LogsList, { logs: buildLogs(LARGE) })
      await view.vm.$nextTick()

      const sentinel = view.find('.abele-logs-list__sentinel')
      expect(scrollIntoView(sentinel.element)).toBe(1)

      await view.vm.$nextTick()
      expect(view.findAll('.abele-logs-list__note')).toHaveLength(DEFAULT_PAGE_SIZE * 2)
    })

    it('drops the sentinel once everything is shown', () => {
      const view = render(LogsList, { logs: buildLogs(5) })

      expect(view.findAll('.abele-logs-list__note')).toHaveLength(5)
      expect(view.find('.abele-logs-list__sentinel').exists()).toBe(false)
    })
  })

  describe('TodoList', () => {
    it('renders one page instead of every task', () => {
      const view = render(TodoList, { tasks: buildTasks(LARGE) })

      expect(view.findAll('.abele-todo-list__task')).toHaveLength(DEFAULT_PAGE_SIZE)
    })

    it('reveals another page when the sentinel scrolls into view', async () => {
      const view = render(TodoList, { tasks: buildTasks(LARGE) })
      await view.vm.$nextTick()

      const sentinel = view.find('.abele-todo-list__sentinel')
      expect(scrollIntoView(sentinel.element)).toBe(1)

      await view.vm.$nextTick()
      expect(view.findAll('.abele-todo-list__task')).toHaveLength(DEFAULT_PAGE_SIZE * 2)
    })

    it('still hides completed tasks, and pages what remains', () => {
      const tasks = buildTasks(LARGE)
      for (const [i, task] of tasks.entries()) {
        if (i % 2 === 0) task.completedAt = dayjs('2026-02-02')
      }

      const view = render(TodoList, { tasks })

      const rendered = view.findAll('.abele-todo-list__task')
      expect(rendered).toHaveLength(DEFAULT_PAGE_SIZE)
      // The window must be filled from the surviving tasks, not padded with hidden ones.
      expect(view.find('.abele-todo-list__no-tasks').exists()).toBe(false)
    })
  })

  describe('Timeline', () => {
    it('renders one page of date blocks instead of every date', () => {
      const view = render(Timeline, { tasks: buildDatedTasks(LARGE) })

      expect(view.findAll('.abele-timeline__date-block')).toHaveLength(DEFAULT_PAGE_SIZE)
    })

    it('reveals another page of date blocks when the sentinel scrolls into view', async () => {
      const view = render(Timeline, { tasks: buildDatedTasks(LARGE) })
      await view.vm.$nextTick()

      const sentinel = view.find('.abele-timeline__sentinel')
      expect(scrollIntoView(sentinel.element)).toBe(1)

      await view.vm.$nextTick()
      expect(view.findAll('.abele-timeline__date-block')).toHaveLength(DEFAULT_PAGE_SIZE * 2)
    })

    it('keeps a multi-day task in every day of its range', () => {
      // Spanning tasks are deliberately repeated per day, which is why the timeline pages by
      // date block rather than by task — slicing tasks would tear a day in half.
      const task = buildTasks(1)[0]
      task.date = dayjs('2026-03-01')
      task.due = dayjs('2026-03-05')

      const view = render(Timeline, { tasks: [task] })

      expect(task.dates).toHaveLength(5)
      expect(view.findAll('.abele-timeline__date-block')).toHaveLength(5)
      expect(view.findAll('.abele-timeline__task')).toHaveLength(5)
    })

    it('does not split a date block across a page boundary', () => {
      // Every task shares one day, so the whole set belongs to a single block and must be
      // rendered together even though it is far larger than a page.
      const tasks = buildTasks(120).map((task) => {
        task.date = dayjs('2026-04-01')
        return task
      })

      const view = render(Timeline, { tasks })

      expect(view.findAll('.abele-timeline__date-block')).toHaveLength(1)
      expect(view.findAll('.abele-timeline__task')).toHaveLength(120)
    })

    it('drops the sentinel once every date block is shown', () => {
      const view = render(Timeline, { tasks: buildDatedTasks(5) })

      expect(view.findAll('.abele-timeline__date-block')).toHaveLength(5)
      expect(view.find('.abele-timeline__sentinel').exists()).toBe(false)
    })
  })
})

/** A task with a priority and labels, as `load()` would leave it after reading frontmatter. */
function taskWith(name: string, props: Record<string, unknown>): Task {
  const task = new Task({ wikilink: `[[Tasks/${name}]]` })
  task.loaded = true
  task.title = name
  task.oldProps = props
  task.priority = (props.priority as Task['priority']) ?? null
  return task
}

/** Opens the label filter's menu and returns its items, as Obsidian would show them. */
async function openLabelMenu(view: VueWrapper): Promise<MenuItem[]> {
  const spy = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  await view.find('.abele-task-label-filter').trigger('click')
  const shown = spy.mock.contexts[0] as unknown as { items: MenuItem[] } | undefined
  spy.mockRestore()
  return shown?.items ?? []
}

const pick = (items: MenuItem[], title: string) => {
  const item = items.find((i) => i.title === title)
  if (!item) throw new Error(`no menu item "${title}" in ${items.map((i) => i.title).join(', ')}`)
  item.handler?.()
}

describe('footer lists — priority and labels', () => {
  beforeEach(() => {
    resetFakeIntersectionObservers()
    installFakeIntersectionObserver()
    useVault([])
    configureAbele()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  describe('TodoList', () => {
    it('puts higher priority first and keeps the given order within a priority', () => {
      const tasks = [
        taskWith('none-1', {}),
        taskWith('low', { priority: 'low' }),
        taskWith('high-1', { priority: 'high' }),
        taskWith('none-2', {}),
        taskWith('high-2', { priority: 'high' }),
        taskWith('medium', { priority: 'medium' }),
      ]
      const view = render(TodoList, { tasks })

      const titles = view.findAllComponents(TaskCard).map((c) => (c.props('task') as Task).title)
      expect(titles).toEqual(['high-1', 'high-2', 'medium', 'low', 'none-1', 'none-2'])
    })

    it('shows no label filter when no task has a label', () => {
      const view = render(TodoList, { tasks: [taskWith('a', {}), taskWith('b', {})] })

      expect(view.find('.abele-task-label-filter').exists()).toBe(false)
    })

    it('narrows the list to one label, and back', async () => {
      const tasks = [
        taskWith('work-1', { labels: ['Work'] }),
        taskWith('home', { labels: 'home' }),
        taskWith('work-2', { labels: ['work', 'home'] }),
        taskWith('bare', {}),
      ]
      const view = render(TodoList, { tasks })
      const titles = () =>
        view.findAllComponents(TaskCard).map((c) => (c.props('task') as Task).title)

      const items = await openLabelMenu(view)
      expect(items.map((i) => i.title)).toEqual([
        'All labels',
        'home (2)',
        'Work (2)',
        'No label (1)',
      ])

      expect(items.find((i) => i.title === 'All labels')?.checked).toBe(true)

      pick(items, 'Work (2)')
      await view.vm.$nextTick()
      expect((await openLabelMenu(view)).find((i) => i.title === 'Work (2)')?.checked).toBe(true)
      expect(titles()).toEqual(['work-1', 'work-2'])
      expect(
        view
          .findAllComponents(ObsidianIcon)
          .find((c) => c.classes().includes('abele-task-label-filter'))
          ?.props('textRight')
      ).toBe('Work')

      pick(await openLabelMenu(view), 'No label (1)')
      await view.vm.$nextTick()
      expect(titles()).toEqual(['bare'])

      pick(await openLabelMenu(view), 'All labels')
      await view.vm.$nextTick()
      expect(titles()).toHaveLength(4)
    })

    it('reads labels from the property the settings name', async () => {
      const config = configureAbele()
      config.taskLabelProperty = 'tags'
      const tasks = [taskWith('a', { tags: ['x'], labels: ['y'] })]
      const view = render(TodoList, { tasks })

      const items = await openLabelMenu(view)
      expect(items.map((i) => i.title)).toContain('x (1)')
      expect(items.map((i) => i.title)).not.toContain('y (1)')
      config.taskLabelProperty = 'labels'
    })
  })

  describe('Timeline', () => {
    it('narrows the date blocks to one label', async () => {
      const a = taskWith('a', { labels: ['work'] })
      a.date = dayjs('2026-05-01')
      const b = taskWith('b', { labels: ['home'] })
      b.date = dayjs('2026-05-02')
      const view = render(Timeline, { tasks: [a, b] })

      pick(await openLabelMenu(view), 'work (1)')
      await view.vm.$nextTick()

      expect(view.findAll('.abele-timeline__date-block')).toHaveLength(1)
      expect(view.findAllComponents(TaskCard).map((c) => (c.props('task') as Task).title)).toEqual([
        'a',
      ])
    })

    it('keeps its date order, not priority order', () => {
      const early = taskWith('early', {})
      early.date = dayjs('2026-05-01')
      const late = taskWith('late', { priority: 'high' })
      late.date = dayjs('2026-05-02')
      const view = render(Timeline, { tasks: [late, early] })

      expect(view.findAllComponents(TaskCard).map((c) => (c.props('task') as Task).title)).toEqual([
        'early',
        'late',
      ])
    })
  })
})
