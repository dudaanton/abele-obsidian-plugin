/**
 * What a task card says about priority and labels.
 *
 * Priority is the first glyph among the codes at the end of the row, and only on tasks without
 * a date: the calendar already orders its tasks by when they happen, so a priority there would
 * say nothing the position does not. Labels follow the title in the same line, on every card,
 * as quiet words marked with the colour the settings give that label. Nothing but the title
 * sits beside the checkbox, left of the text.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import dayjs from 'dayjs'
import { Task } from '@/entities/Task'
import TaskCard from '@/components/Task.vue'
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

  it('shows a label per label, in the configured colour or grey, after the title', () => {
    const config = configureAbele()
    config.taskLabelColors = [{ value: 'Work', color: 'green' }]
    const card = render(taskWith({ labels: ['work', 'home'] }))

    const chips = card.findAll('.abele-task-view__title .abele-task-view__label')
    expect(chips.map((c) => c.text())).toEqual(['work', 'home'])
    expect(chips.map((c) => c.classes())).toEqual([
      ['abele-task-view__label', 'abele-task-view__label_green'],
      ['abele-task-view__label', 'abele-task-view__label_grey'],
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

  it('puts the glyph first among the codes, apart from the labels', () => {
    const card = render(taskWith({ priority: 'high', labels: ['work', 'home'] }))

    const codes = card.find('.abele-task-view__codes')
    expect(codes.exists()).toBe(true)
    expect(codes.element.children[0].classList.contains('abele-task-view__priority')).toBe(true)
    expect(codes.findAll('.abele-task-view__label')).toHaveLength(0)
    expect(card.findAll('.abele-task-view__title .abele-task-view__label')).toHaveLength(2)
  })

  it('keeps the glyph among the codes when there are no labels', () => {
    const card = render(taskWith({ priority: 'low' }))

    const codes = card.find('.abele-task-view__codes')
    expect(codes.element.children).toHaveLength(1)
    expect(codes.element.children[0].classList.contains('abele-task-view__priority')).toBe(true)
  })

  it('has nothing beside the checkbox but the title', () => {
    const card = render(taskWith({ priority: 'medium', labels: ['work'] }))

    const direct = Array.from(card.element.children).map((el) => (el as Element).className)
    expect(direct.some((c) => c.includes('abele-task-view__priority'))).toBe(false)
  })
})
