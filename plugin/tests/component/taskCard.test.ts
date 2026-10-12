/**
 * What a task card says about priority and labels.
 *
 * Priority is the colour of the box to tick, its word in that box's label, and only on tasks
 * without a date: the calendar already orders its tasks by when they happen, so a priority there
 * would say nothing the position does not. Labels stand on the line under the title, on every
 * card, as quiet words marked with the colour the settings give that label. Nothing but the
 * title sits on the first line, so it keeps the width.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import { Task } from '@/entities/Task'
import TaskCard from '@/components/Task.vue'
import { installFakeIntersectionObserver } from '../helpers/fakeIntersectionObserver'
import { useVault, configureAbele } from '../helpers/testEnv'

function taskWith(props: Record<string, unknown>): Task {
  const task = new Task({ wikilink: '[[Tasks/Card]]' })
  task.loaded = true
  task.title = 'Card'
  task.oldProps = props
  task.priority = (props.priority as Task['priority']) ?? null
  return task
}

let view: VueWrapper | null = null
const render = (task: Task, extra: Record<string, unknown> = {}) => {
  view = mount(TaskCard, {
    props: { task, ...extra },
    shallow: true,
    global: { stubs: { EntryRow: false, LabelDot: false } },
  })
  return view
}

const priorityIcon = (v: VueWrapper) => {
  const box = v.find('.task-list-label')
  const color = /abele-task-view__check_(\w+)/.exec(box.attributes('class') ?? '')?.[1]
  return color ? { color, label: box.attributes('aria-label') } : undefined
}

describe('task card — priority and labels', () => {
  beforeEach(() => {
    installFakeIntersectionObserver()
    useVault([])
    configureAbele()
  })

  afterEach(() => {
    view?.unmount()
    view = null
  })

  it.each([
    ['high', 'red'],
    ['medium', 'orange'],
    ['low', 'blue'],
  ])('marks %s priority by the colour of its box', (priority, color) => {
    const mark = priorityIcon(render(taskWith({ priority })))
    expect(mark?.color).toBe(color)
    expect(mark?.label).toBe(`${priority[0].toUpperCase()}${priority.slice(1)} priority`)
  })

  it('shows no colour for a task without priority', () => {
    expect(priorityIcon(render(taskWith({})))).toBeUndefined()
  })

  it('shows no colour for a task with a date', () => {
    const task = taskWith({ priority: 'high' })
    task.date = dayjs('2026-05-01')

    expect(priorityIcon(render(task))).toBeUndefined()
  })

  it('shows a label per label, in the configured colour or grey, on the line under the title', () => {
    const config = configureAbele()
    config.taskLabelColors = [{ value: 'Work', color: 'green' }]
    const card = render(taskWith({ labels: ['work', 'home'] }))

    expect(card.find('.abele-task-view__title .abele-task-view__label').exists()).toBe(false)
    const chips = card.findAll('.abele-entry-row__meta .abele-task-view__label')
    expect(chips.map((c) => c.text())).toEqual(['work', 'home'])
    expect(chips.map((c) => c.classes())).toEqual([
      ['abele-label-dot', 'abele-label-dot_green', 'abele-task-view__label'],
      ['abele-label-dot', 'abele-label-dot_grey', 'abele-task-view__label'],
    ])
    config.taskLabelColors = []
  })

  it('shows labels on calendar cards too', () => {
    const task = taskWith({ labels: ['work'] })
    task.date = dayjs('2026-05-01')

    expect(render(task, { atTimeline: true }).findAll('.abele-task-view__label')).toHaveLength(1)
  })

  it('has no label without labels', () => {
    expect(render(taskWith({})).find('.abele-task-view__label').exists()).toBe(false)
  })

  it('keeps the labels off the title line and the codes', () => {
    const card = render(taskWith({ priority: 'high', labels: ['work', 'home'] }))

    expect(card.findAll('.abele-entry-row__codes .abele-task-view__label')).toHaveLength(0)
    expect(card.findAll('.abele-entry-row__meta .abele-task-view__label')).toHaveLength(2)
  })

  it('keeps the priority on the checkbox when there are no labels', () => {
    const card = render(taskWith({ priority: 'low' }))
    expect(priorityIcon(card)).toEqual({ color: 'blue', label: 'Low priority' })
    expect(card.find('.abele-entry-row__meta').exists()).toBe(false)
  })

  it('has nothing beside the checkbox but the title', () => {
    const card = render(taskWith({ priority: 'medium', labels: ['work'] }))

    const direct = Array.from(card.element.children).map((el) => (el as Element).className)
    expect(direct.some((c) => c.includes('abele-task-view__priority'))).toBe(false)
  })
})
