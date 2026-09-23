/**
 * The Labels section of the task settings: which property labels are read from, and a colour
 * per label. The labels offered are the ones tasks already carry — read from the task list in
 * memory — plus any given a colour before, plus any typed in by hand.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import TaskLabelsSettings from '@/components/settings/TaskLabelsSettings.vue'
import Setting from '@/components/obsidian/Setting.vue'
import Badge from '@/components/obsidian/Badge.vue'
import Button from '@/components/obsidian/Button.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { Task } from '@/entities/Task'
import type { TasksList } from '@/entities/TasksList'
import { useVault, configureAbele } from '../helpers/testEnv'

function taskWith(labels: unknown): Task {
  const task = new Task({ wikilink: `[[Tasks/${String(labels)}]]` })
  task.oldProps = { labels }
  return task
}

let config: AbeleConfig
let view: VueWrapper | null = null

beforeEach(() => {
  useVault([])
  config = configureAbele()
  config.taskLabelProperty = 'labels'
  config.taskLabelColors = [{ value: 'Urgent', color: 'red' }]
  vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
  GlobalStore.getInstance().tasksList.value = {
    tasks: new Map([
      ['a', taskWith(['work', 'home'])],
      ['b', taskWith('Work')],
    ]),
  } as unknown as TasksList
})

afterEach(() => {
  view?.unmount()
  view = null
  GlobalStore.getInstance().tasksList.value = null
  config.taskLabelColors = []
  vi.restoreAllMocks()
})

const rows = (v: VueWrapper) =>
  v
    .findAllComponents(Setting)
    .filter((s) => s.findComponent(Badge).exists())
    .map((s) => s.findComponent(Badge).props('text'))

const rowFor = (v: VueWrapper, label: string) => {
  const row = v
    .findAllComponents(Setting)
    .find((s) => s.findComponent(Badge).exists() && s.findComponent(Badge).props('text') === label)
  if (!row) throw new Error(`no row for ${label}: ${rows(v).join(', ')}`)
  return row
}

describe('task label settings screen', () => {
  it('lists the labels in use and the coloured ones, once each', () => {
    view = mount(TaskLabelsSettings)

    expect(rows(view)).toEqual(['home', 'Urgent', 'work'])
  })

  it('previews each label in its colour', () => {
    view = mount(TaskLabelsSettings)

    expect(rowFor(view, 'Urgent').findComponent(Badge).props('color')).toBe('red')
    expect(rowFor(view, 'work').findComponent(Badge).props('color')).toBe('grey')
  })

  it('stores a colour chosen for a label', async () => {
    view = mount(TaskLabelsSettings)

    await rowFor(view, 'work').find('select').setValue('blue')

    expect(config.taskLabelColors).toContainEqual({ value: 'work', color: 'blue' })
    expect(config.saveSettings).toHaveBeenCalled()
  })

  it('forgets the colour when set back to grey', async () => {
    view = mount(TaskLabelsSettings)

    await rowFor(view, 'Urgent').find('select').setValue('grey')

    expect(config.taskLabelColors).toEqual([])
  })

  it('adds a label by hand so it can be coloured before any task has it', async () => {
    view = mount(TaskLabelsSettings)

    await view.find('.abele-task-labels__new input').setValue('Someday')
    await view
      .findAllComponents(Button)
      .find((b) => b.props('text') === 'Add')!
      .trigger('click')
    await nextTick()

    expect(rows(view)).toContain('Someday')
  })

  it('stores the label property, falling back to the default when emptied', async () => {
    view = mount(TaskLabelsSettings)
    const input = view.find('.abele-task-labels__property input')

    await input.setValue('tags')
    expect(config.taskLabelProperty).toBe('tags')

    await input.setValue('  ')
    expect(config.taskLabelProperty).toBe('labels')
  })
})
