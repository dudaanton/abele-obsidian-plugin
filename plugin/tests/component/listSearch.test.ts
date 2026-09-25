/**
 * Search in the task and log lists.
 *
 * The lists page: only the first twenty entries are mounted, and an entry reads its own text
 * from disk only once it is on screen. A search that looked at what is rendered, or at the
 * text entries happen to hold, would miss everything further down — so these tests put the
 * one matching entry far past the first page, with nothing loaded into it, and expect the
 * search to find it. They also count reads: typing must not go back to the disk for every
 * note on every keystroke.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import { TFile } from 'obsidian'
import { Task } from '@/entities/Task'
import { Log } from '@/entities/Log'
import TodoList from '@/components/TodoList.vue'
import Timeline from '@/components/Timeline.vue'
import LogsList from '@/components/LogsList.vue'
import ObsidianIcon from '@/components/obsidian/Icon.vue'
import type { FakeApp, FakeFileSpec } from '../helpers/fakeVault'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
} from '../helpers/fakeIntersectionObserver'
import { useVault, configureAbele } from '../helpers/testEnv'

const COUNT = 500
const PAGE = 20
/** Far past the first page, so only a search over the whole list can find it. */
const NEEDLE = 450
/** Longer than the list's typing delay. */
const SETTLE_MS = 400

function taskSpecs(): FakeFileSpec[] {
  return Array.from({ length: COUNT }, (_, i) => ({
    path: `Tasks/Task ${i}.md`,
    frontmatter: { type: 'task' },
    content:
      i === NEEDLE
        ? `Renew documents\nRemember the Passport photos`
        : `Chore number ${i}\nNothing special`,
  }))
}

/** Tasks as a sidebar holds them: registered, but no text read — none of them is on screen. */
function buildTasks(dated = false): Task[] {
  return Array.from({ length: COUNT }, (_, i) => {
    const task = new Task({ wikilink: `[[Tasks/Task ${i}]]` })
    task.loaded = true
    if (dated) task.date = dayjs('2026-01-01').add(i, 'day')
    return task
  })
}

let wrapper: VueWrapper | null = null
let app: FakeApp

function render(component: unknown, props: Record<string, unknown>): VueWrapper {
  wrapper = mount(component as never, {
    props,
    // The entries themselves are not under test, only which of them the list hands out.
    global: { stubs: { Task: true, Log: true } },
  }) as VueWrapper
  return wrapper
}

function searchIcon(view: VueWrapper) {
  const icon = view.findAllComponents(ObsidianIcon).find((c) => c.props('icon') === 'search')
  if (!icon) throw new Error('no search icon in the header')
  return icon
}

function input(view: VueWrapper) {
  return view.find<HTMLInputElement>('input[type="search"]')
}

async function type(view: VueWrapper, text: string) {
  await input(view).setValue(text)
  await vi.advanceTimersByTimeAsync(SETTLE_MS)
  await flushPromises()
}

function shownTaskNames(view: VueWrapper): string[] {
  return view.findAllComponents({ name: 'Task' }).map((c) => (c.props('task') as Task).taskName)
}

describe('searching a list', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetFakeIntersectionObservers()
    installFakeIntersectionObserver()
    configureAbele()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  describe('TodoList', () => {
    beforeEach(() => {
      app = useVault(taskSpecs())
    })

    it('has a search icon in the header that says what it does', () => {
      const view = render(TodoList, { tasks: buildTasks() })
      const icon = searchIcon(view)

      expect(icon.props('tooltip')).toMatch(/search/i)
      expect(input(view).exists()).toBe(false)
    })

    it('opens a field and finds a task far down the list by its description', async () => {
      const view = render(TodoList, { tasks: buildTasks() })
      await searchIcon(view).trigger('click')
      expect(input(view).exists()).toBe(true)

      await type(view, 'passport')

      expect(shownTaskNames(view)).toEqual([`Task ${NEEDLE}`])
    })

    it('finds by title, ignoring case', async () => {
      const view = render(TodoList, { tasks: buildTasks() })
      await searchIcon(view).trigger('click')

      await type(view, 'RENEW DOC')

      expect(shownTaskNames(view)).toEqual([`Task ${NEEDLE}`])
    })

    it('waits for typing to pause before filtering', async () => {
      const view = render(TodoList, { tasks: buildTasks() })
      await searchIcon(view).trigger('click')
      await flushPromises()

      await input(view).setValue('passport')
      expect(shownTaskNames(view)).toHaveLength(PAGE)

      await vi.advanceTimersByTimeAsync(SETTLE_MS)
      await flushPromises()
      expect(shownTaskNames(view)).toEqual([`Task ${NEEDLE}`])
    })

    it('reads each note once, not once per keystroke', async () => {
      const view = render(TodoList, { tasks: buildTasks() })
      app.resetStats()
      await searchIcon(view).trigger('click')

      await type(view, 'pass')
      await type(view, 'passp')
      await type(view, 'passport')

      expect(app.stats.read).toBe(COUNT)
      expect(shownTaskNames(view)).toEqual([`Task ${NEEDLE}`])
    })

    it('reads a note again once it has changed', async () => {
      const view = render(TodoList, { tasks: buildTasks() })
      await searchIcon(view).trigger('click')
      await type(view, 'passport')

      const file = app.vault.getAbstractFileByPath('Tasks/Task 3.md') as TFile
      await app.vault.modify(file, '---\ntype: task\n---\nPassport renewal for the kids')
      file.stat = { ...file.stat, mtime: 1 }

      await type(view, 'passport ')
      expect(shownTaskNames(view).sort()).toEqual([`Task 3`, `Task ${NEEDLE}`])
    })

    it('does not match what is only in the properties', async () => {
      const view = render(TodoList, { tasks: buildTasks() })
      await searchIcon(view).trigger('click')

      await type(view, 'type: task')

      expect(shownTaskNames(view)).toEqual([])
      expect(view.text()).toMatch(/nothing matches/i)
    })

    it('closes and clears on Escape', async () => {
      const view = render(TodoList, { tasks: buildTasks() })
      await searchIcon(view).trigger('click')
      await type(view, 'passport')

      await input(view).trigger('keydown', { key: 'Escape' })
      await flushPromises()

      expect(input(view).exists()).toBe(false)
      expect(shownTaskNames(view)).toHaveLength(PAGE)

      await searchIcon(view).trigger('click')
      expect(input(view).element.value).toBe('')
    })

    it('closes and clears when the icon is pressed again', async () => {
      const view = render(TodoList, { tasks: buildTasks() })
      await searchIcon(view).trigger('click')
      await type(view, 'passport')
      expect(searchIcon(view).props('active')).toBe(true)

      await searchIcon(view).trigger('click')
      await flushPromises()

      expect(input(view).exists()).toBe(false)
      expect(shownTaskNames(view)).toHaveLength(PAGE)
    })
  })

  describe('Timeline', () => {
    it('narrows the calendar tasks the same way', async () => {
      useVault(taskSpecs())
      const view = render(Timeline, { tasks: buildTasks(true) })
      await searchIcon(view).trigger('click')

      await type(view, 'passport')

      expect(shownTaskNames(view)).toEqual([`Task ${NEEDLE}`])
      expect(view.findAll('.abele-timeline__date-block')).toHaveLength(1)
    })
  })

  describe('LogsList', () => {
    const LOGS = 100
    const LOG_NEEDLE = 90

    function logSpecs(): FakeFileSpec[] {
      return [
        { path: 'Notes/Group.md', content: '' },
        ...Array.from({ length: LOGS }, (_, i) => ({
          path: `Logs/Log ${i}.md`,
          frontmatter: { type: 'log' },
          content:
            i === LOG_NEEDLE
              ? 'Talked about the roof with [[Group]]\n\nLater bought a guitar'
              : `Routine entry ${i} for [[Group]]`,
        })),
      ]
    }

    function buildLogs(): Log[] {
      return Array.from({ length: LOGS }, (_, i) => {
        const log = new Log(`Logs/Log ${i}.md`, 'Notes/Group.md')
        log.createdAt = dayjs('2026-01-01').subtract(i, 'day')
        return log
      })
    }

    function shownLogNames(view: VueWrapper): string[] {
      return view.findAllComponents({ name: 'Log' }).map((c) => (c.props('log') as Log).name)
    }

    it('finds a log far down the list by what it says about this note', async () => {
      useVault(logSpecs())
      const view = render(LogsList, { logs: buildLogs() })
      await searchIcon(view).trigger('click')

      await type(view, 'Roof')

      expect(shownLogNames(view)).toEqual([`Log ${LOG_NEEDLE}`])
    })

    it('does not match a paragraph the list would not show for this note', async () => {
      useVault(logSpecs())
      const view = render(LogsList, { logs: buildLogs() })
      await searchIcon(view).trigger('click')

      await type(view, 'guitar')

      expect(shownLogNames(view)).toEqual([])
    })

    it('closes and clears on Escape', async () => {
      useVault(logSpecs())
      const view = render(LogsList, { logs: buildLogs() })
      await searchIcon(view).trigger('click')
      await type(view, 'roof')

      await input(view).trigger('keydown', { key: 'Escape' })
      await flushPromises()

      expect(input(view).exists()).toBe(false)
      expect(shownLogNames(view)).toHaveLength(PAGE)
    })
  })
})
