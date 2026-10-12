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
// The header is a row of glyphs; each is found by its place in the row and named by its label.
const button = (name: 'toggle' | 'date' | 'due' | 'recurrence' | 'clear') =>
  view
    .findAllComponents(Icon)
    .find((icon) => icon.classes().includes(`abele-task-header-view__${name}`))!
const labels = () => view.findAllComponents(Icon).map((icon) => icon.props('label'))

describe('task header controls', () => {
  it('loads on mount and toggles completion/undo through the note editor', async () => {
    const load = vi.spyOn(task, 'load')
    await render()
    expect(load).toHaveBeenCalledOnce()
    expect(button('toggle').props()).toMatchObject({ icon: 'square', label: 'Mark done' })
    expect(button('toggle').attributes('aria-checked')).toBe('false')
    await button('toggle').trigger('click')
    await flushPromises()
    expect(button('toggle').props()).toMatchObject({
      icon: 'check-square',
      label: 'Mark not done',
    })
    expect(button('toggle').attributes('aria-checked')).toBe('true')
    expect(await parseNoteContent(env.file, env.text())).toHaveProperty('completed', '2028-01-31')
    await button('toggle').trigger('click')
    await flushPromises()
    expect(await parseNoteContent(env.file, env.text())).not.toHaveProperty('completed')
  })

  it.each(['event', 'due'] as const)(
    'opens the picker in %s mode straight from its glyph on an undated task',
    async (mode) => {
      const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
      await render()
      expect(labels()).toEqual([
        'Mark done',
        'Set date',
        'Set due date',
        'Set repeat',
        'Add subtask',
      ])
      expect(button('date').props('textRight')).toBeUndefined()
      expect(button('due').props('textRight')).toBeUndefined()
      await button(mode === 'event' ? 'date' : 'due').trigger('click')
      expect(shown).not.toHaveBeenCalled()
      const picker = view.findComponent(DateTimePickerModal)
      expect(picker.props('mode')).toBe(mode)
      picker.vm.$emit('confirm', { date: dayjs('2028-02-29'), time: '08:30' })
      await flushPromises()
      expect(view.findComponent(DateTimePickerModal).exists()).toBe(false)
      expect((mode === 'event' ? task.date : task.due).format('YYYY-MM-DD HH:mm')).toBe(
        '2028-02-29 08:30'
      )
      const set = button(mode === 'event' ? 'date' : 'due')
      expect(set.props()).toMatchObject({
        label: mode === 'event' ? 'Change date' : 'Change due date',
        textRight: '29.02 08:30',
      })
      const other = button(mode === 'event' ? 'due' : 'date')
      expect(other.props('label')).toBe(mode === 'event' ? 'Set due date' : 'Set date')
      expect(button('clear')).toBeDefined()
    }
  )

  it.each(['event', 'due'] as const)(
    'edits and clears an existing %s date and time',
    async (mode) => {
      await task.load()
      if (mode === 'event') await task.setEventDate(dayjs('2028-02-01'), '10:15')
      else await task.setDueDate(dayjs('2028-02-01'), '10:15')
      await render()
      const glyph = () => button(mode === 'event' ? 'date' : 'due')
      expect(glyph().props('textRight')).toBe('Tomorrow 10:15')
      await glyph().trigger('click')
      const picker = view.findComponent(DateTimePickerModal)
      expect(picker.props('mode')).toBe(mode)
      expect(picker.props('initialDate').format('YYYY-MM-DD')).toBe('2028-02-01')
      expect(picker.props('initialTime')).toBe('10:15')
      picker.vm.$emit('clear')
      await flushPromises()
      expect(mode === 'event' ? task.date : task.due).toBeNull()
      expect(glyph().props('label')).toBe(mode === 'event' ? 'Set date' : 'Set due date')
      expect(glyph().props('textRight')).toBeUndefined()
      expect(view.findComponent(DateTimePickerModal).exists()).toBe(false)
    }
  )

  it('opens the missing endpoint directly, cancels without writing and shows both once set', async () => {
    await task.load()
    await task.setEventDate(dayjs('2028-02-01'))
    await render()
    expect(button('due').props('label')).toBe('Set due date')
    await button('due').trigger('click')
    expect(view.findComponent(DateTimePickerModal).props('mode')).toBe('due')
    view.findComponent(DateTimePickerModal).vm.$emit('cancel')
    await flushPromises()
    expect(task.due).toBeNull()
    await task.setDueDate(dayjs('2028-01-29'))
    await view.vm.$nextTick()
    expect(labels()).not.toContain('Set date')
    expect(labels()).not.toContain('Set due date')
    expect(button('date').props()).toMatchObject({ label: 'Change date', textRight: 'Tomorrow' })
    expect(button('due').props()).toMatchObject({
      label: 'Change due date',
      textRight: '29.01',
      color: 'red',
    })
  })

  it('confirms, cancels and clears recurrence through its modal', async () => {
    await render()
    expect(button('recurrence').props('label')).toBe('Set repeat')
    await button('recurrence').trigger('click')
    expect(view.findComponent(RecurrencePickerModal).props('initialPattern')).toBeNull()
    view.findComponent(RecurrencePickerModal).vm.$emit('confirm', 'every last day of month')
    await flushPromises()
    expect(task.recurrence).toBe('every last day of month')
    expect(view.findComponent(RecurrencePickerModal).exists()).toBe(false)
    expect(button('recurrence').props()).toMatchObject({
      label: 'Change repeat',
      textRight: 'every last day of month',
    })
    await button('recurrence').trigger('click')
    expect(view.findComponent(RecurrencePickerModal).props('initialPattern')).toBe(task.recurrence)
    view.findComponent(RecurrencePickerModal).vm.$emit('cancel')
    await flushPromises()
    expect(task.recurrence).toBe('every last day of month')
    await button('recurrence').trigger('click')
    view.findComponent(RecurrencePickerModal).vm.$emit('clear')
    await flushPromises()
    expect(task.recurrence).toBeNull()
    expect(button('recurrence').props('label')).toBe('Set repeat')
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
      expect(button('clear').props('label')).toBe('Clear dates, repeat and done')
      await button('clear').trigger('click')
      await flushPromises()
      expect(toggle).toHaveBeenCalledTimes(completed ? 1 : 0)
      const data = await parseNoteContent(env.file, env.text())
      for (const prop of ['date', 'dateTime', 'due', 'dueTime', 'completed', 'recurrence'])
        expect(data).not.toHaveProperty(prop)
      expect(data.content).toContain('Water seedlings')
      expect(button('clear')).toBeUndefined()
    }
  )

  it('shows only a missing-task message when no editor is available', async () => {
    env.close()
    await render()
    expect(view.text()).toBe('Task not found')
    expect(view.findAllComponents(Icon)).toHaveLength(0)
  })
})
