import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import dayjs from 'dayjs'
import 'dayjs/locale/ru'
import { GlobalStore } from '@/stores/GlobalStore'
import Timeline from '@/components/Timeline.vue'
import { Task } from '@/entities/Task'
import { configureAbele, useVault } from '../helpers/testEnv'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'

vi.mock('@/composables/useDate', () => ({ useDate: () => ({ now: ref(dayjs('2030-06-15')) }) }))
let view: VueWrapper
let owner: HTMLElement
const sample = (name: string, date: string, completed = false) => {
  const task = new Task({ wikilink: `[[Sample/${name}]]`, date: dayjs(date) })
  task.loaded = true
  task.title = name
  task.content = name + '\n'
  if (completed) task.completedAt = dayjs(date)
  return task
}
const days = () =>
  view.findAll('.abele-timeline__date-block').map((d) => d.attributes('data-abele-anchor'))
const row = () => view.find('.abele-timeline__task')
const pointer = async (type: string, x: number, y: number, target: EventTarget = document) => {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: x,
      clientY: y,
    })
  )
  await flushPromises()
}
const touch = async (type: string, x: number, y: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    touches: { value: type === 'touchend' ? [] : [{ identifier: 1, clientX: x, clientY: y }] },
    changedTouches: { value: [{ identifier: 1, clientX: x, clientY: y }] },
  })
  row().element.dispatchEvent(event)
  await flushPromises()
  return event
}
const render = async (tasks: Task[]) => {
  view = mount(Timeline, { props: { tasks }, shallow: true, attachTo: owner })
  await flushPromises()
  vi.spyOn(row().element, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 180, 250, 40))
}
beforeEach(() => {
  useVault([])
  configureAbele()
  installFakeIntersectionObserver()
  owner = document.createElement('div')
  owner.style.overflowY = 'auto'
  document.body.append(owner)
  vi.spyOn(owner, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 500))
})
afterEach(() => {
  view?.unmount()
  owner.remove()
  dayjs.locale('en')
  vi.restoreAllMocks()
})

describe('timeline task dragging', () => {
  it.each([
    ['en', true, 'Saturday', 'Sunday', 'Monday'],
    ['en', false, 'Saturday', 'Sunday', 'Monday'],
    ['ru', true, 'суббота', 'воскресенье', 'понедельник'],
    ['ru', false, 'суббота', 'воскресенье', 'понедельник'],
  ] as const)(
    'labels drag dates in locale %s with Monday-first=%s without changing normal date links',
    async (locale, monday, saturday, sunday, mondayName) => {
      configureAbele().weekStartsOnMonday = monday
      GlobalStore.getInstance().applySettings()
      dayjs.locale(locale)
      await render([sample('sample-current', '2030-06-15')])
      const label = (day: string) =>
        view.find(`[data-abele-anchor="date:${day}"] .timeline__date`).attributes('text')
      const normal = label('2030-06-15')
      await pointer('pointerdown', 80, 190, row().element)
      await pointer('pointermove', 80, 205)
      for (const [day, weekday] of [
        ['2030-06-15', saturday],
        ['2030-06-16', sunday],
        ['2030-06-17', mondayName],
      ]) {
        expect(label(day)).toContain(weekday)
        expect(label(day)).toContain(`[[${day}|`)
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await flushPromises()
      expect(label('2030-06-15')).toBe(normal)
    }
  )

  it('leaves a click alone and expands every calendar date only after movement exceeds the threshold', async () => {
    await render([sample('sample-current', '2030-06-15')])
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 83, 193)
    expect(days()).toEqual(['date:2030-06-15'])
    await pointer('pointerup', 83, 193)
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    row().element.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 80, 205)
    expect(days()).toHaveLength(62)
    expect(days()[0]).toBe('date:2030-05-15')
    expect(days().at(-1)).toBe('date:2030-07-15')
    expect(document.querySelector('.abele-timeline__drag-card')).not.toBeNull()
    const dragClick = new MouseEvent('click', { bubbles: true, cancelable: true })
    row().element.dispatchEvent(dragClick)
    expect(dragClick.defaultPrevented).toBe(true)
  })

  it('temporarily shows hidden past and completed rows within the month and restores both on Escape', async () => {
    const current = sample('sample-current', '2030-06-15')
    current.dateTime = dayjs('2030-06-15T09:30')
    current.due = dayjs('2030-06-15')
    current.dueTime = dayjs('2030-06-15T17:00')
    const before = {
      date: current.date,
      due: current.due,
      dateTime: current.dateTime,
      dueTime: current.dueTime,
      content: current.content,
    }
    const write = vi.spyOn(current, 'writeTaskToFile').mockResolvedValue(undefined)
    await render([
      sample('sample-past', '2030-06-14'),
      sample('sample-done', '2030-06-13', true),
      sample('sample-archive', '2020-01-01', true),
      current,
    ])
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 80, 205)
    expect(view.findAll('[data-timeline-item]')).toHaveLength(3)
    expect(days()).not.toContain('date:2020-01-01')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(days()).toEqual(['date:2030-06-15'])
    expect(view.findAll('[data-timeline-item]')).toHaveLength(1)
    expect(write).not.toHaveBeenCalled()
    expect(document.querySelector('.abele-timeline__drag-card')).toBeNull()
    expect(view.find('.abele-timeline__drag-source').exists()).toBe(false)
    expect(view.find('.abele-timeline__dragging').exists()).toBe(false)
    expect(view.find('.abele-timeline__drop-target').exists()).toBe(false)
    for (const field of ['date', 'due', 'dateTime', 'dueTime', 'content'] as const)
      expect(current[field]).toBe(before[field])
    await pointer('pointerup', 80, 205)
    expect(write).not.toHaveBeenCalled()
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 80, 205)
    expect(days()).toHaveLength(62)
    await pointer('pointercancel', 80, 205)
    expect(days()).toEqual(['date:2030-06-15'])
    expect(write).not.toHaveBeenCalled()
  })

  it('uses the task persistence API on drop and keeps the landing day when history is hidden', async () => {
    const current = sample('sample-current', '2030-06-15')
    const write = vi.spyOn(current, 'writeTaskToFile').mockResolvedValue(undefined)
    await render([current, sample('sample-done', '2030-06-13', true)])
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 80, 205)
    const target = view.find('[data-abele-anchor="date:2030-06-14"]').element
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target)
    await pointer('pointermove', 80, 130)
    await pointer('pointerup', 80, 130)
    expect(write).toHaveBeenCalledTimes(1)
    expect(current.date?.format('YYYY-MM-DD')).toBe('2030-06-14')
    expect(days()).toEqual(['date:2030-06-14'])
    expect(view.findAll('[data-timeline-item]')).toHaveLength(1)
    expect(document.querySelector('.abele-timeline__drag-card')).toBeNull()
    // Picking up the landed card and putting it back on the same hidden day must not
    // make it disappear or write the task a second time.
    await pointer('pointerdown', 80, 130, row().element)
    await pointer('pointermove', 80, 145)
    vi.mocked(document.elementFromPoint).mockReturnValue(
      view.find('[data-abele-anchor="date:2030-06-14"]').element
    )
    await pointer('pointerup', 80, 145)
    expect(write).toHaveBeenCalledTimes(1)
    expect(days()).toEqual(['date:2030-06-14'])
    await pointer('pointerdown', 80, 130, row().element)
    await pointer('pointermove', 80, 145)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(write).toHaveBeenCalledTimes(1)
    expect(days()).toEqual(['date:2030-06-14'])
  })

  it.each(['date', 'due', 'range'] as const)(
    'shifts %s tasks without losing times, duration or completion metadata',
    async (kind) => {
      const current = sample('sample-current', '2030-06-15')
      current.dateTime = dayjs('2030-06-15T09:30')
      if (kind !== 'date') {
        current.due = dayjs(kind === 'range' ? '2030-06-17T17:00' : '2030-06-15T17:00')
        current.dueTime = current.due
      }
      if (kind === 'due') {
        current.date = null
        current.dateTime = null
      }
      const write = vi.spyOn(current, 'writeTaskToFile').mockResolvedValue(undefined)
      await render([current])
      await pointer('pointerdown', 80, 190, row().element)
      await pointer('pointermove', 80, 205)
      vi.spyOn(document, 'elementFromPoint').mockReturnValue(
        view.find('[data-abele-anchor="date:2030-06-18"]').element
      )
      await pointer('pointerup', 80, 300)
      expect(write).toHaveBeenCalledTimes(1)
      if (kind === 'due') expect(current.date).toBeNull()
      else {
        expect(current.date?.format('YYYY-MM-DD')).toBe('2030-06-18')
        expect(current.dateTime?.format('YYYY-MM-DD HH:mm')).toBe('2030-06-18 09:30')
      }
      if (kind !== 'date') {
        expect(current.due?.format('YYYY-MM-DD')).toBe(
          kind === 'range' ? '2030-06-20' : '2030-06-18'
        )
        expect(current.dueTime?.format('HH:mm')).toBe('17:00')
      }
    }
  )

  it('overrides completed filtering only for past occurrences inside the temporary month', async () => {
    const done = sample('sample-span-done', '2030-05-01', true)
    done.due = dayjs('2030-06-20')
    await render([sample('sample-current', '2030-06-15'), done])
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 80, 205)
    const occurrences = view
      .findAll(`[data-timeline-item="task:${done.id}"]`)
      .map((row) =>
        row.element.closest('.abele-timeline__date-block')?.getAttribute('data-abele-anchor')
      )
    expect(occurrences).toHaveLength(31)
    expect(occurrences.every((day) => day! >= 'date:2030-05-15' && day! < 'date:2030-06-15')).toBe(
      true
    )
  })

  it('rolls the in-memory dates back and restores filters if persistence fails', async () => {
    const current = sample('sample-current', '2030-06-15')
    const write = vi
      .spyOn(current, 'writeTaskToFile')
      .mockRejectedValue(new Error('sample write failure'))
    await render([current])
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 80, 205)
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(
      view.find('[data-abele-anchor="date:2030-06-18"]').element
    )
    await pointer('pointerup', 80, 300)
    expect(write).toHaveBeenCalledTimes(1)
    expect(current.date?.format('YYYY-MM-DD')).toBe('2030-06-15')
    expect(days()).toEqual(['date:2030-06-15'])
    expect(document.querySelector('.abele-timeline__drag-card')).toBeNull()
  })

  it('cancels a drop outside, a cancelled pointer, and disposal without writing', async () => {
    const current = sample('sample-current', '2030-06-15')
    const write = vi.spyOn(current, 'writeTaskToFile').mockResolvedValue(undefined)
    await render([current])
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(document.body)
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 80, 205)
    await pointer('pointerup', 500, 205)
    expect(days()).toEqual(['date:2030-06-15'])
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 80, 205)
    await pointer('pointercancel', 80, 205)
    expect(days()).toEqual(['date:2030-06-15'])
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 80, 205)
    view.unmount()
    expect(document.querySelector('.abele-timeline__drag-card')).toBeNull()
    expect(write).not.toHaveBeenCalled()
    expect(current.date?.format('YYYY-MM-DD')).toBe('2030-06-15')
  })

  it('lets a touch swipe scroll; a long press still needs movement before starting a drag', async () => {
    await render([sample('sample-current', '2030-06-15')])
    await touch('touchstart', 80, 190)
    expect((await touch('touchmove', 80, 230)).defaultPrevented).toBe(false)
    await new Promise((r) => setTimeout(r, 500))
    expect(days()).toHaveLength(1)
    await touch('touchend', 80, 230)
    await touch('touchstart', 80, 190)
    await new Promise((r) => setTimeout(r, 500))
    expect(days()).toHaveLength(1)
    // Once the long press arms dragging, prevent even the first sub-threshold move:
    // WebKit otherwise starts a native pan before the drag can claim the gesture.
    expect((await touch('touchmove', 80, 193)).defaultPrevented).toBe(true)
    expect(days()).toHaveLength(1)
    expect((await touch('touchmove', 80, 205)).defaultPrevented).toBe(true)
    expect(days()).toHaveLength(62)
    await touch('touchcancel', 80, 205)
    expect(days()).toHaveLength(1)
  })

  it('uses the visible phone edge above floating navigation for auto-scroll', async () => {
    document.body.classList.add('is-phone')
    const bar = document.createElement('div')
    bar.className = 'mobile-navbar'
    document.body.append(bar)
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 450, 300, 50))
    try {
      await render([sample('sample-current', '2030-06-15')])
      await pointer('pointerdown', 80, 190, row().element)
      await pointer('pointermove', 80, 205)
      await pointer('pointermove', 80, 440)
      const start = owner.scrollTop
      await new Promise((r) => setTimeout(r, 600))
      expect(owner.scrollTop).toBeGreaterThan(start)
    } finally {
      bar.remove()
      document.body.classList.remove('is-phone')
    }
  })

  it('starts gentle edge scrolling after a delay and stops when the pointer leaves the edge', async () => {
    await render([sample('sample-current', '2030-06-15')])
    await pointer('pointerdown', 80, 190, row().element)
    await pointer('pointermove', 80, 205)
    await pointer('pointermove', 80, 490)
    const start = owner.scrollTop
    await new Promise((r) => setTimeout(r, 100))
    expect(owner.scrollTop).toBe(start)
    await new Promise((r) => setTimeout(r, 500))
    expect(owner.scrollTop).toBeGreaterThan(start)
    expect(owner.scrollTop - start).toBeLessThan(100)
    await pointer('pointermove', 80, 250)
    const stopped = owner.scrollTop
    await new Promise((r) => setTimeout(r, 300))
    expect(owner.scrollTop).toBe(stopped)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  })
})
