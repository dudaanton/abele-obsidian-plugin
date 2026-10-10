import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import dayjs from 'dayjs'
import { Menu } from 'obsidian'
import TaskCard from '@/components/Task.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import { Task } from '@/entities/Task'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { taskHarness, TASK_PATH } from '../helpers/taskHarness'
import {
  installFakeIntersectionObserver,
  resetFakeIntersectionObservers,
  scrollIntoView,
} from '../helpers/fakeIntersectionObserver'

const opened = vi.hoisted(() => vi.fn())
vi.mock('@/helpers/vaultUtils', async (original) => ({
  ...(await original<typeof import('@/helpers/vaultUtils')>()),
  openFile: opened,
}))
let view: VueWrapper | undefined
let task: Task
beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Berlin')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2028-01-31T10:00:00+01:00'))
  taskHarness()
  installFakeIntersectionObserver()
  opened.mockClear()
  task = reactive(
    new Task({ wikilink: '[[Water seedlings]]', filePath: 'Daily/2028-01-31.md' })
  ) as Task
})
afterEach(() => {
  view?.unmount()
  view = undefined
  task.cleanup()
  VaultWatcherWrapper.destroy()
  resetFakeIntersectionObservers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
const render = async (atTimeline = false) => {
  view = mount(TaskCard, { props: { task, atTimeline }, shallow: true })
  await flushPromises()
  return view
}
const reveal = async () => {
  expect(scrollIntoView(view.find('.abele-task-view').element)).toBeGreaterThan(0)
  await flushPromises()
}

describe('task card content and date presentation', () => {
  it('loads metadata on mount and the title/body only on first visibility', async () => {
    const load = vi.spyOn(task, 'load')
    const content = vi.spyOn(task, 'loadContent')
    await render()
    expect(load).toHaveBeenCalledOnce()
    expect(content).not.toHaveBeenCalled()
    expect(view.findAllComponents(Markdown)).toHaveLength(0)
    await reveal()
    await reveal()
    expect(content).toHaveBeenCalledOnce()
    expect(view.attributes('data-abele-anchor')).toBe(`task:${TASK_PATH}`)
    expect(view.findComponent(Markdown).props()).toMatchObject({
      text: 'Water seedlings',
      filePath: 'Daily/2028-01-31.md',
    })
    const chevron = view
      .findAllComponents(Icon)
      .find((icon) => icon.props('icon') === 'chevron-down')!
    await chevron.trigger('click')
    expect(view.findAllComponents(Markdown).map((markdown) => markdown.props('text'))).toEqual([
      'Water seedlings',
      '- [x] Tray one\n- [X] Tray two\n- [ ] Tray three',
    ])
    expect(opened).not.toHaveBeenCalled()
    await view
      .findAllComponents(Icon)
      .find((icon) => icon.props('icon') === 'chevron-up')!
      .trigger('click')
    expect(view.findAllComponents(Markdown)).toHaveLength(1)
  })

  it.each([
    ['2028-01-31', '(Today)'],
    ['2028-02-01', '(Tomorrow)'],
    ['2028-01-30', '(Yesterday)'],
    ['2028-02-03', '(3 days left)'],
    ['2028-01-28', '(3 days ago)'],
  ])('formats event and due date %s as %s', async (date, label) => {
    await task.load()
    task.date = dayjs(date)
    task.due = dayjs(date)
    await render()
    expect(view.text().split(label)).toHaveLength(3)
    expect(view.text()).toContain(`Date: ${dayjs(date).format('DD.MM.YYYY')}`)
    expect(view.text()).toContain(`Due: ${dayjs(date).format('DD.MM.YYYY')}`)
  })

  it('shows overdue only before today, not earlier today, completed, or in a timeline', async () => {
    await task.load()
    task.due = dayjs('2028-01-31 08:00')
    await render()
    expect(view.find('.abele-task-view__indicator').exists()).toBe(false)
    task.due = dayjs('2028-01-30')
    await view.vm.$nextTick()
    expect(view.find('.abele-task-view__indicator').exists()).toBe(true)
    await view.setProps({ atTimeline: true })
    expect(view.find('.abele-task-view__indicator').exists()).toBe(false)
    await view.setProps({ atTimeline: false })
    task.completedAt = dayjs('2028-01-31')
    await view.vm.$nextTick()
    expect(view.find('.abele-task-view__indicator').exists()).toBe(false)
    expect(view.text()).toContain('Completed: 31.01.2028')
    expect(view.text()).not.toContain('(Yesterday)')
    expect((view.find('input').element as HTMLInputElement).checked).toBe(true)
    task.completedAt = null
    await view.vm.$nextTick()
    expect((view.find('input').element as HTMLInputElement).checked).toBe(false)
  })

  it('shows timeline times/countdown, updates each second and stops the timer on unmount', async () => {
    await task.load()
    task.date = dayjs('2028-01-31 11:05')
    task.dateTime = task.date
    task.due = dayjs('2028-01-31 18:00')
    task.dueTime = task.due
    await render(true)
    expect(view.text()).toContain('at 11:05')
    expect(view.text()).toContain('due 18:00')
    expect(view.text()).toContain('(in 01:05)')
    expect(view.text()).not.toContain('Date:')
    await vi.advanceTimersByTimeAsync(1000)
    expect(view.text()).toContain('(in 01:04)')
    task.completedAt = dayjs()
    await view.vm.$nextTick()
    expect(view.text()).not.toContain('(in ')
    task.completedAt = null
    task.dateTime = dayjs('2028-01-31 09:00')
    await view.vm.$nextTick()
    expect(view.text()).not.toContain('(in ')
    view.unmount()
    view = undefined
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shows no countdown without a time or outside the timeline', async () => {
    await task.load()
    await render(true)
    expect(view.text()).not.toContain('(in ')
    task.dateTime = dayjs('2028-02-01 10:00')
    await view.setProps({ atTimeline: false })
    expect(view.text()).not.toContain('(in ')
  })

  it('renders a missing task with an orphan-removal action and no checkbox', async () => {
    task = reactive(
      new Task({ wikilink: '[[sample-missing]]', filePath: 'Daily/2028-01-31.md' })
    ) as Task
    const remove = vi.spyOn(task, 'removeOrphanedLink').mockImplementation(() => {})
    await render()
    expect(view.text()).toBe('Task not found')
    expect(view.find('input').exists()).toBe(false)
    await view.findComponent(Icon).trigger('click')
    expect(remove).toHaveBeenCalledOnce()
  })
})

describe('task card interactions', () => {
  it('checkbox delegates to toggle without opening the card', async () => {
    const toggle = vi.spyOn(task, 'toggle').mockResolvedValue()
    await render()
    await view.find('input').trigger('click')
    expect(toggle).toHaveBeenCalledOnce()
    expect(opened).not.toHaveBeenCalled()
  })

  it.each(['a.internal-link', 'span.abele-obsidian-icon', 'label'])(
    'does not open from %s',
    async (selector) => {
      await render()
      const [tag, cls] = selector.split('.')
      const child = document.createElement(tag)
      child.className = cls ?? ''
      view.element.appendChild(child)
      child.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(opened).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])('context-menu deletion respects confirmation %s', async (confirmed) => {
    const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
    vi.stubGlobal(
      'confirm',
      vi.fn(() => confirmed)
    )
    const remove = vi.spyOn(task, 'remove').mockResolvedValue()
    await render()
    await view.trigger('contextmenu', { clientX: 12, clientY: 34 })
    const item = (
      shown.mock.contexts[0] as unknown as {
        items: Array<{ title: string; icon: string; handler: () => void }>
      }
    ).items[0]
    expect(item.title).toBe('Delete')
    expect(item.icon).toBe('trash')
    item.handler()
    expect(remove).not.toHaveBeenCalled()
    expect(window.confirm).not.toHaveBeenCalled()
    const dialog = document.querySelector('.abele-modal')!
    expect(dialog?.querySelector('.abele-confirm__message')?.textContent).toBe(
      'Are you sure you want to delete this task?'
    )
    const button = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent === (confirmed ? 'Delete' : 'Cancel')
    )!
    button.click()
    await flushPromises()
    expect(remove).toHaveBeenCalledTimes(confirmed ? 1 : 0)
  })
})
