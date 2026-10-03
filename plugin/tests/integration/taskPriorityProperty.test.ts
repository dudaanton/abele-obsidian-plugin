import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { Task } from '@/entities/Task'
import { TaskNoteTemplate } from '@/templates/TaskNoteTemplate'
import { createReadTasksTool } from '@/ai/tools/RelationTools'
import TaskLabelsSettings from '@/components/settings/TaskLabelsSettings.vue'
import { collectEntries, applyEntries } from '@/transfer/entries'
import { parseNoteContent } from '@/helpers/notesUtils'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault, configureAbele } from '../helpers/testEnv'

beforeEach(() => {
  useVault([
    {
      path: 'Tasks/sample-task.md',
      content: 'Sample task',
      frontmatter: { type: 'task', priority: 'Low', importance: [' High '] },
    },
  ])
  configureAbele().applySettings(undefined)
})
afterEach(() => {
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
})

describe('dedicated task priority property', () => {
  it('defaults and persists independently of widget names, and travels in Tasks', () => {
    const config = AbeleConfig.getInstance()
    expect(config.taskPriorityProperty).toBe('priority')
    config.applySettings({ taskPriorityProperty: ' importance ', priorityProperties: [] })
    expect(config.taskPriorityProperty).toBe('importance')
    const saved = config.exportSettings()
    config.applySettings(saved)
    expect(config.taskPriorityProperty).toBe('importance')
    expect(config.priorityProperties).toEqual([])
    const entry = collectEntries(saved).find((e) => e.section === 'tasks')!
    expect(applyEntries([entry], {} as never).taskPriorityProperty).toBe('importance')
    config.applySettings({ taskPriorityProperty: '  ', priorityProperties: ['a', 'b'] })
    expect(config.taskPriorityProperty).toBe('priority')
    expect(config.priorityProperties).toEqual(['a', 'b'])
  })

  it('reads task and tool priority from the selected key without migrating old values', async () => {
    const config = AbeleConfig.getInstance()
    config.taskPriorityProperty = 'importance'
    const task = new Task({ wikilink: '[[Tasks/sample-task]]' })
    await task.load()
    expect(task.priority).toBe('high')
    const result = await createReadTasksTool().execute('sample-call', {}, undefined as never)
    expect(JSON.stringify(result)).toContain('priority:high')
    config.taskPriorityProperty = 'priority'
    config.version.value++
    expect(task.priority).toBe('low')
    task.cleanup()
  })

  it('writes an explicit priority to the configured key, preserving other properties and casing', async () => {
    const config = AbeleConfig.getInstance()
    config.taskPriorityProperty = 'importance'
    const template = new TaskNoteTemplate({} as never)
    const text = template.createTemplate({
      oldProps: { priority: 'Low', custom: 'Keep' },
      priority: 'high',
      content: 'Sample task',
    })
    expect(await parseNoteContent(null, text)).toMatchObject({
      importance: 'high',
      priority: 'Low',
      custom: 'Keep',
    })
    const untouched = template.createTemplate({
      oldProps: { importance: [' High '], priority: 'Low' },
      content: 'Sample task',
    })
    expect((await parseNoteContent(null, untouched)).importance).toEqual([' High '])
    const cleared = template.createTemplate({
      oldProps: { importance: 'High', priority: 'Low' },
      priority: null,
    })
    expect(await parseNoteContent(null, cleared)).not.toHaveProperty('importance')
    expect((await parseNoteContent(null, cleared)).priority).toBe('Low')
  })

  it('uses the configured key on entity writes while preserving an implicit rewrite verbatim', async () => {
    const config = AbeleConfig.getInstance()
    config.taskPriorityProperty = 'importance'
    const task = new Task({ wikilink: '[[Tasks/sample-task]]' })
    await task.load()
    await task.loadContent()
    const { app } = (await import('@/stores/GlobalStore')).GlobalStore.getInstance()
    const file = app.vault.getFileByPath('Tasks/sample-task.md')!
    await task.writeTaskToFile()
    expect((await parseNoteContent(null, await app.vault.read(file))).importance).toEqual([
      ' High ',
    ])
    task.priority = 'medium'
    await task.writeTaskToFile()
    expect(await parseNoteContent(null, await app.vault.read(file))).toMatchObject({
      importance: 'medium',
      priority: 'Low',
    })
    task.priority = null
    await task.writeTaskToFile()
    expect(await parseNoteContent(null, await app.vault.read(file))).not.toHaveProperty(
      'importance'
    )
    task.cleanup()
  })

  it('offers a native input alongside the label property', async () => {
    const config = AbeleConfig.getInstance()
    vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
    const view = mount(TaskLabelsSettings)
    try {
      const row = view.find('.abele-task-labels__priority-property')
      expect(row.exists()).toBe(true)
      await row.find('input').setValue('importance')
      expect(config.taskPriorityProperty).toBe('importance')
    } finally {
      view.unmount()
    }
  })
})
