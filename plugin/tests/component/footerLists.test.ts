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
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import { Note } from '@/entities/Note'
import { Log } from '@/entities/Log'
import { Task } from '@/entities/Task'
import NotesList from '@/components/NotesList.vue'
import LogsList from '@/components/LogsList.vue'
import TodoList from '@/components/TodoList.vue'
import Timeline from '@/components/Timeline.vue'
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

      const rendered = view.findAll('.abele-notes-list__item a').map((el) => el.text())
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
