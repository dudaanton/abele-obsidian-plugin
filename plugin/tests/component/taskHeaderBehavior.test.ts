import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import dayjs from 'dayjs'
import { Menu } from 'obsidian'
import TaskHeaderView from '@/components/TaskHeader.vue'
import DateTimePickerModal from '@/components/DateTimePickerModal.vue'
import RecurrencePickerModal from '@/components/RecurrencePickerModal.vue'
import Icon from '@/components/obsidian/Icon.vue'
import { TaskHeader } from '@/entities/TaskHeader'
import { parseNoteContent } from '@/helpers/notesUtils'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { taskHarness, TASK_PATH } from '../helpers/taskHarness'

vi.mock('@/composables/useTimerButton', () => ({
  useTimerButton: () => ({
    showTimerButton: ref(false),
    isTimerActiveForNote: ref(false),
    timerElapsedText: ref(''),
    toggleTimer: vi.fn(),
  }),
}))
vi.mock('@/composables/useScriptButtons', () => ({
  useScriptButtons: () => ({ scriptButtons: ref([]), runButton: vi.fn() }),
}))
let view: VueWrapper | undefined
let task: TaskHeader
let env: ReturnType<typeof taskHarness>
beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Berlin')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2028-01-31T23:30:00+01:00'))
  env = taskHarness()
  task = reactive(new TaskHeader({ id: 'header', filePath: TASK_PATH })) as TaskHeader
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  view?.unmount()
  view = undefined
  if (task.watcherInitialized) task.cleanup()
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})
const render = async () => {
  view = mount(TaskHeaderView, { props: { task }, shallow: true })
  await flushPromises()
}
const button = (text: string) =>
  view.findAllComponents(Icon).find((icon) => icon.props('textRight') === text)!
const texts = () => view.findAllComponents(Icon).map((icon) => icon.props('textRight'))

describe('task header controls', () => {
  it('loads on mount and toggles completion/undo through the note editor', async () => {
    const load = vi.spyOn(task, 'load')
    await render()
    expect(load).toHaveBeenCalledOnce()
    expect(button('Complete').props('icon')).toBe('square')
    await button('Complete').trigger('click')
    await flushPromises()
    expect(button('Undone').props('icon')).toBe('check-square')
    expect(await parseNoteContent(env.file, env.text())).toHaveProperty('completed', '2028-01-31')
    await button('Undone').trigger('click')
    await flushPromises()
    expect(await parseNoteContent(env.file, env.text())).not.toHaveProperty('completed')
  })

  it.each(['event', 'due'] as const)(
    'offers a menu for an undated task and routes the %s choice to the picker',
    async (mode) => {
      const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
      await render()
      expect(texts()).toEqual(['Complete', 'Add Date', 'Recurrence', 'Clear'])
      await button('Add Date').trigger('click')
      const items = (
        shown.mock.contexts[0] as unknown as {
          items: Array<{ title: string; handler: () => void }>
        }
      ).items
      expect(items.map((item) => item.title)).toEqual(['Event date', 'Due date'])
      items[mode === 'event' ? 0 : 1].handler()
      await view.vm.$nextTick()
      const picker = view.findComponent(DateTimePickerModal)
      expect(picker.props('mode')).toBe(mode)
      picker.vm.$emit('confirm', { date: dayjs('2028-02-29'), time: '08:30' })
      await flushPromises()
      expect(view.findComponent(DateTimePickerModal).exists()).toBe(false)
      expect((mode === 'event' ? task.date : task.due).format('YYYY-MM-DD HH:mm')).toBe(
        '2028-02-29 08:30'
      )
      expect(texts()).toContain(mode === 'event' ? 'Add Due Date' : 'Add Event Date')
    }
  )

  it.each(['event', 'due'] as const)(
    'edits and clears an existing %s date and time',
    async (mode) => {
      await task.load()
      if (mode === 'event') await task.setEventDate(dayjs('2028-02-01'), '10:15')
      else await task.setDueDate(dayjs('2028-02-01'), '10:15')
      await render()
      await button(mode === 'event' ? 'Edit Event Date' : 'Edit Due Date').trigger('click')
      const picker = view.findComponent(DateTimePickerModal)
      expect(picker.props('mode')).toBe(mode)
      expect(picker.props('initialDate').format('YYYY-MM-DD')).toBe('2028-02-01')
      expect(picker.props('initialTime')).toBe('10:15')
      picker.vm.$emit('clear')
      await flushPromises()
      expect(mode === 'event' ? task.date : task.due).toBeNull()
      expect(texts()).toContain('Add Date')
      expect(view.findComponent(DateTimePickerModal).exists()).toBe(false)
    }
  )

  it('adds the missing endpoint directly, cancels without writing and hides Add when both exist', async () => {
    await task.load()
    await task.setEventDate(dayjs('2028-02-01'))
    await render()
    await button('Add Due Date').trigger('click')
    expect(view.findComponent(DateTimePickerModal).props('mode')).toBe('due')
    view.findComponent(DateTimePickerModal).vm.$emit('cancel')
    await flushPromises()
    expect(task.due).toBeNull()
    await task.setDueDate(dayjs('2028-02-02'))
    await view.vm.$nextTick()
    expect(texts()).not.toContain('Add Date')
    expect(texts()).not.toContain('Add Due Date')
    expect(texts()).toContain('Edit Event Date')
    expect(texts()).toContain('Edit Due Date')
  })

  it('confirms, cancels and clears recurrence through its modal', async () => {
    await render()
    await button('Recurrence').trigger('click')
    expect(view.findComponent(RecurrencePickerModal).props('initialPattern')).toBeNull()
    view.findComponent(RecurrencePickerModal).vm.$emit('confirm', 'every last day of month')
    await flushPromises()
    expect(task.recurrence).toBe('every last day of month')
    expect(view.findComponent(RecurrencePickerModal).exists()).toBe(false)
    await button('Recurrence').trigger('click')
    expect(view.findComponent(RecurrencePickerModal).props('initialPattern')).toBe(task.recurrence)
    view.findComponent(RecurrencePickerModal).vm.$emit('cancel')
    await flushPromises()
    expect(task.recurrence).toBe('every last day of month')
    await button('Recurrence').trigger('click')
    view.findComponent(RecurrencePickerModal).vm.$emit('clear')
    await flushPromises()
    expect(task.recurrence).toBeNull()
  })

  it.each([false, true])(
    'Clear removes dates, times, recurrence and completion (initially completed: %s)',
    async (completed) => {
      await task.load()
      await task.setEventDate(dayjs('2028-02-01'), '08:00')
      await task.setDueDate(dayjs('2028-02-02'), '17:00')
      await task.addRecurrence('every week')
      if (completed) {
        task.completedAt = dayjs('2028-01-31')
        await task.writeContentToEditor()
      }
      await render()
      const toggle = vi.spyOn(task, 'toggle')
      await button('Clear').trigger('click')
      await flushPromises()
      expect(toggle).toHaveBeenCalledTimes(completed ? 1 : 0)
      const data = await parseNoteContent(env.file, env.text())
      for (const prop of ['date', 'dateTime', 'due', 'dueTime', 'completed', 'recurrence'])
        expect(data).not.toHaveProperty(prop)
      expect(data.content).toContain('Water seedlings')
    }
  )

  it('shows only a missing-task message when no editor is available', async () => {
    env.close()
    await render()
    expect(view.text()).toBe('Task not found')
    expect(view.findAllComponents(Icon)).toHaveLength(0)
  })
})
