/**
 * Every list under a note folds away to its heading.
 *
 * A note with hundreds of transactions pushed its logs out of reach: every list grows a page
 * each time the scroll reaches its end, so nothing below a long one could be scrolled to. Under
 * a note — and only there, since the sidebars show one list each — a list's heading folds it,
 * says how many entries it holds, and the fold is remembered for that note.
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
import TransactionsList from '@/components/TransactionsList.vue'
import TimeEntryListView from '@/components/TimeEntryListView.vue'
import ChatsList from '@/components/ChatsList.vue'
import FoldHeading from '@/components/obsidian/FoldHeading.vue'
import { FOOTER_FOLD, FOOTER_FOLDS_KEY, resetFooterFolds } from '@/composables/useFooterFold'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'
import { useVault, configureAbele } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const logs = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const log = new Log(`Logs/Log ${i}.md`, 'Notes/Group.md')
    log.createdAt = dayjs('2026-01-01').subtract(i, 'day')
    return log
  })

const tasks = (n: number, dated = false) =>
  Array.from({ length: n }, (_, i) => {
    const task = new Task({ wikilink: `[[Tasks/Task ${i}]]` })
    task.loaded = true
    task.title = `Task ${i}`
    if (dated) task.date = dayjs('2026-01-01').add(i, 'day')
    return task
  })

const notes = (n: number) => Array.from({ length: n }, (_, i) => new Note(`Notes/Note ${i}.md`))

/** Each list, what it is handed, and how many entries its heading should report. */
const LISTS = [
  { name: 'TodoList', component: TodoList, props: () => ({ tasks: tasks(3) }), count: 3 },
  { name: 'Timeline', component: Timeline, props: () => ({ tasks: tasks(4, true) }), count: 4 },
  {
    name: 'TransactionsList',
    component: TransactionsList,
    props: () => ({ transactions: [] }),
    count: 0,
  },
  {
    name: 'TimeEntryListView',
    component: TimeEntryListView,
    props: () => ({ timeEntries: [] }),
    count: 0,
  },
  { name: 'NotesList', component: NotesList, props: () => ({ notes: notes(5) }), count: 5 },
  { name: 'LogsList', component: LogsList, props: () => ({ logs: logs(30) }), count: 30 },
  { name: 'ChatsList', component: ChatsList, props: () => ({ chats: [] }), count: 0 },
] as const

let app: FakeApp
let wrappers: VueWrapper[] = []

function render(
  component: unknown,
  props: Record<string, unknown>,
  notePath: string | null = 'Notes/A.md'
): VueWrapper {
  const view = mount(component as never, {
    props,
    shallow: true,
    global: {
      stubs: { FoldHeading: false },
      provide: notePath ? { [FOOTER_FOLD as symbol]: () => notePath } : {},
    },
  }) as VueWrapper
  wrappers.push(view)
  return view
}

const heading = (view: VueWrapper) => view.find('.abele-fold-heading')

describe('folding the lists under a note', () => {
  beforeEach(() => {
    installFakeIntersectionObserver()
    app = useVault([])
    configureAbele()
    resetFooterFolds()
  })

  afterEach(() => {
    for (const w of wrappers) w.unmount()
    wrappers = []
  })

  for (const list of LISTS) {
    describe(list.name, () => {
      it('opens with its entries, and the heading says it can be folded', () => {
        const view = render(list.component, list.props())

        expect(heading(view).attributes('role')).toBe('button')
        expect(heading(view).attributes('aria-expanded')).toBe('true')
        expect(heading(view).find('.collapse-icon').exists()).toBe(true)
        expect(view.element.children.length).toBeGreaterThan(1)
      })

      it('folds to its heading and the number of entries on a click', async () => {
        const view = render(list.component, list.props())

        await heading(view).trigger('click')

        expect(heading(view).attributes('aria-expanded')).toBe('false')
        expect(heading(view).find('.collapse-icon').classes()).toContain('is-collapsed')
        expect(heading(view).find('.abele-fold-heading__count').text()).toBe(String(list.count))
        // Nothing but the header row is left: no entries, no search, no empty-list line.
        expect(view.element.children).toHaveLength(1)
      })

      it('is remembered for the note, and for that note only', async () => {
        const first = render(list.component, list.props())
        await heading(first).trigger('click')

        const again = render(list.component, list.props())
        const other = render(list.component, list.props(), 'Notes/B.md')

        expect(heading(again).attributes('aria-expanded')).toBe('false')
        expect(heading(other).attributes('aria-expanded')).toBe('true')
        expect(app.loadLocalStorage(FOOTER_FOLDS_KEY)).toBeTruthy()
      })

      it('does not fold in a sidebar, where it is the only list', () => {
        const view = render(list.component, list.props(), null)

        expect(heading(view).attributes('role')).toBeUndefined()
        expect(heading(view).find('.collapse-icon').exists()).toBe(false)
      })
    })
  }

  it('folds from the keyboard, by Enter and by Space', async () => {
    const view = render(LogsList, { logs: logs(3) })

    await heading(view).trigger('keydown', { key: 'Enter' })
    expect(heading(view).attributes('aria-expanded')).toBe('false')
    await heading(view).trigger('keydown', { key: ' ' })
    expect(heading(view).attributes('aria-expanded')).toBe('true')
    expect(heading(view).attributes('tabindex')).toBe('0')
  })

  it('reads the fold stored by an earlier session', () => {
    app.saveLocalStorage(FOOTER_FOLDS_KEY, { 'Notes/A.md': ['logs'] })
    resetFooterFolds()

    const view = render(LogsList, { logs: logs(3) })

    expect(heading(view).attributes('aria-expanded')).toBe('false')
  })
})

describe('FoldHeading', () => {
  it('draws the text and count, and folds nothing unless it is collapsible', () => {
    const view = mount(FoldHeading, { props: { text: 'Logs', count: 4 } })

    expect(view.find('.abele-fold-heading__text').text()).toBe('Logs')
    expect(view.find('.collapse-icon').exists()).toBe(false)
    expect(view.attributes('role')).toBeUndefined()
  })

  it("draws Obsidian's own fold arrow, turned while collapsed", () => {
    const view = mount(FoldHeading, {
      props: { text: 'Logs', collapsible: true, collapsed: true },
    })

    const arrow = view.find('.collapse-icon')
    expect(arrow.classes()).toContain('is-collapsed')
    expect(arrow.attributes('aria-hidden')).toBe('true')
  })

  it('asks to toggle on a click, Enter or Space', async () => {
    const view = mount(FoldHeading, { props: { text: 'Logs', collapsible: true } })

    await view.trigger('click')
    await view.trigger('keydown', { key: 'Enter' })
    await view.trigger('keydown', { key: ' ' })
    await view.trigger('keydown', { key: 'a' })

    expect(view.emitted('toggle')).toHaveLength(3)
  })
})
