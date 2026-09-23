/**
 * What a task card says about priority and labels.
 *
 * Priority is a glyph beside the checkbox, and only on tasks without a date: the calendar
 * already orders its tasks by when they happen, so a priority there would say nothing the
 * position does not. Labels are chips under the title, on every card, tinted with the colour
 * the settings give that label.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import { Task } from '@/entities/Task'
import TaskCard from '@/components/Task.vue'
import Badge from '@/components/obsidian/Badge.vue'
import ObsidianIcon from '@/components/obsidian/Icon.vue'
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
  view = mount(TaskCard, { props: { task, ...extra }, shallow: true })
  return view
}

const priorityIcon = (v: VueWrapper) =>
  v.findAllComponents(ObsidianIcon).find((c) => c.classes().includes('abele-task-view__priority'))

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
    ['high', 'chevron-up', 'red'],
    ['medium', 'equal', 'orange'],
    ['low', 'chevron-down', 'blue'],
  ])('marks %s priority with its own glyph and colour', (priority, icon, color) => {
    const card = render(taskWith({ priority }))

    const glyph = priorityIcon(card)
    expect(glyph?.props('icon')).toBe(icon)
    expect(glyph?.props('color')).toBe(color)
    expect(glyph?.props('tooltip')).toBe(
      `${priority[0].toUpperCase()}${priority.slice(1)} priority`
    )
  })

  it('shows no glyph for a task without priority', () => {
    expect(priorityIcon(render(taskWith({})))).toBeUndefined()
  })

  it('shows no glyph for a task with a date', () => {
    const task = taskWith({ priority: 'high' })
    task.date = dayjs('2026-05-01')

    expect(priorityIcon(render(task))).toBeUndefined()
  })

  it('shows a chip per label, in the configured colour or grey', () => {
    const config = configureAbele()
    config.taskLabelColors = [{ value: 'Work', color: 'green' }]
    const card = render(taskWith({ labels: ['work', 'home'] }))

    const chips = card.findAllComponents(Badge)
    expect(chips.map((c) => c.props('text'))).toEqual(['work', 'home'])
    expect(chips.map((c) => c.props('color'))).toEqual(['green', 'grey'])
    config.taskLabelColors = []
  })

  it('shows chips on calendar cards too', () => {
    const task = taskWith({ labels: ['work'] })
    task.date = dayjs('2026-05-01')

    expect(render(task, { atTimeline: true }).findAllComponents(Badge)).toHaveLength(1)
  })

  it('has no chip row without labels', () => {
    expect(render(taskWith({})).find('.abele-task-view__labels').exists()).toBe(false)
  })
})
