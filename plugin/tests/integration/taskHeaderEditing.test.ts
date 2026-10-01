import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { TaskHeader } from '@/entities/TaskHeader'
import { parseNoteContent } from '@/helpers/notesUtils'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { taskHarness, TASK_BODY, TASK_PATH } from '../helpers/taskHarness'

const headers: TaskHeader[] = []
function make() {
  const value = new TaskHeader({ id: 'header', filePath: TASK_PATH })
  headers.push(value)
  return value
}
beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Berlin')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2028-01-31T23:30:00+01:00'))
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  for (const header of headers.splice(0)) if (header.watcherInitialized) header.cleanup()
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('editing dates in the task note header', () => {
  it('keeps quoted calendar dates in a western time zone', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    const env = taskHarness()
    env.editor.setValue("---\ntype: task\ndue: '2028-03-01'\n---\nWater seedlings")
    const header = make()
    await header.load()
    expect(header.due.format('YYYY-MM-DD')).toBe('2028-03-01')
  })

  // BUG: YAML turns an unquoted date into UTC midnight; parseNoteContent converts it to
  // local time before extracting the date. West of UTC, loading and saving shifts it back a day.
  it.fails('keeps an unquoted calendar date in a western time zone', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')
    const env = taskHarness()
    env.editor.setValue('---\ntype: task\ndue: 2028-03-01\n---\nWater seedlings')
    const header = make()
    await header.load()
    expect(header.due.format('YYYY-MM-DD')).toBe('2028-03-01')
  })

  it('clears missing state after its editor becomes available again', async () => {
    const env = taskHarness()
    const views = vi.spyOn(env.app.workspace, 'getLeavesOfType').mockReturnValueOnce([])
    const header = make()
    await header.load()
    expect(header.taskNotFound).toBe(true)
    views.mockRestore()
    await header.load(true)
    expect(header.taskNotFound).toBe(false)
  })

  it('loads unsaved editor frontmatter rather than cache, once unless forced', async () => {
    const env = taskHarness({ due: '2028-02-01' })
    env.editor.setValue(
      '---\ntype: task\ncreated: "2028-01-02"\ncompleted: "2028-01-03"\ndate: "2028-02-02"\ndateTime: "08:30"\ndue: "2028-02-03"\ndueTime: "17:45"\nrecurrence: every month\n---\nUnsaved'
    )
    const header = make()
    await header.load()
    expect(header.date.format('YYYY-MM-DD HH:mm')).toBe('2028-02-02 08:30')
    expect(header.due.format('YYYY-MM-DD HH:mm')).toBe('2028-02-03 17:45')
    expect(header.createdAt.format('YYYY-MM-DD')).toBe('2028-01-02')
    expect(header.completedAt.format('YYYY-MM-DD')).toBe('2028-01-03')
    expect(header.recurrence).toBe('every month')
    expect(header.oldProps.content).toBeUndefined()
    env.editor.setValue('---\ntype: task\n---\nUnsaved')
    await header.load()
    expect(header.due).not.toBeNull()
    await header.load(true)
    expect(header.due).toBeNull()
    expect(header.date).toBeNull()
    expect(header.recurrence).toBeNull()
  })

  it.each([undefined, 'Tomorrow', 'NEXT WEEK', 'next month', 'unrecognized'])(
    'adds relative dates %s at a month boundary, without replacing existing dates',
    async (relative) => {
      const env = taskHarness()
      const header = make()
      await header.load()
      const expected =
        { Tomorrow: '2028-02-01', 'NEXT WEEK': '2028-02-07', 'next month': '2028-02-29' }[
          relative ?? ''
        ] ?? '2028-01-31'
      await header.addEventDate(relative)
      await header.addDueDate(relative)
      expect(header.date.format('YYYY-MM-DD')).toBe(expected)
      expect(header.due.format('YYYY-MM-DD')).toBe(expected)
      await header.addEventDate('next week')
      await header.addDueDate('next week')
      expect(header.date.format('YYYY-MM-DD')).toBe(expected)
      expect(header.due.format('YYYY-MM-DD')).toBe(expected)
      expect(await parseNoteContent(env.file, env.text())).toMatchObject({
        date: expected,
        due: expected,
        content: TASK_BODY,
      })
    }
  )

  it('sets date and time together, clears time when omitted, and removes dates with their times', async () => {
    const env = taskHarness()
    const header = make()
    await header.load()
    await header.setEventDate(dayjs('2028-02-29'), '07:15')
    await header.setDueDate(dayjs('2028-03-01'), '23:45')
    expect(await parseNoteContent(env.file, env.text())).toMatchObject({
      date: '2028-02-29',
      dateTime: '07:15',
      due: '2028-03-01',
      dueTime: '23:45',
    })
    expect(header.date.hour()).toBe(7)
    expect(header.due.hour()).toBe(23)
    await header.setEventDate(dayjs('2028-03-02'))
    await header.setDueDate(dayjs('2028-03-03'), null)
    expect(header.dateTime).toBeNull()
    expect(header.dueTime).toBeNull()
    await header.addEventTime('06:10')
    await header.addDueTime('18:20')
    await header.removeEventDate()
    await header.removeDueDate()
    const data = await parseNoteContent(env.file, env.text())
    for (const key of ['date', 'dateTime', 'due', 'dueTime']) expect(data).not.toHaveProperty(key)
    expect(header.dateTime).toBeNull()
    expect(header.dueTime).toBeNull()
  })

  it('defaults missing dates to today and missing times to noon, keeping existing times', async () => {
    taskHarness()
    const header = make()
    await header.load()
    await header.addEventTime()
    await header.addDueTime()
    expect(header.date.format('YYYY-MM-DD HH:mm')).toBe('2028-01-31 12:00')
    expect(header.due.format('YYYY-MM-DD HH:mm')).toBe('2028-01-31 12:00')
    await header.addEventTime('09:20')
    await header.addDueTime('19:25')
    await header.addEventTime()
    await header.addDueTime()
    expect(header.dateTime.format('HH:mm')).toBe('09:20')
    expect(header.dueTime.format('HH:mm')).toBe('19:25')
    await header.removeEventTime()
    expect(header.dateTime).toBeNull()
    // Removing the time flag currently leaves hours on the in-memory date until reload.
    expect(header.date.hour()).toBe(9)
  })

  it('adds/removes recurrence without validating it and preserves the latest editor body', async () => {
    const env = taskHarness({ labels: ['garden'], custom: 'retain' })
    const header = make()
    await header.load()
    env.editor.setValue(env.text() + '\nNew unsaved paragraph\n')
    const log = vi.spyOn(console, 'log')
    await header.addRecurrence('not validated here')
    expect(await parseNoteContent(env.file, env.text())).toMatchObject({
      recurrence: 'not validated here',
      labels: ['garden'],
      custom: 'retain',
      content: TASK_BODY + '\nNew unsaved paragraph\n',
    })
    await header.removeRecurrence()
    expect(await parseNoteContent(env.file, env.text())).not.toHaveProperty('recurrence')
    expect(log).not.toHaveBeenCalled()
  })

  it('does not write when the file or its editor is absent', async () => {
    const env = taskHarness()
    env.close()
    const header = make()
    await header.load()
    expect(header.taskNotFound).toBe(true)
    const text = env.text()
    await header.setDueDate(dayjs('2028-02-01'))
    expect(env.text()).toBe(text)
    await env.app.vault.delete(env.file)
    await expect(header.writeContentToEditor()).resolves.toBeUndefined()
  })

  it('cleans loaded state and refuses subsequent reload', async () => {
    taskHarness({ due: '2028-02-01', recurrence: 'every day' })
    const header = make()
    await header.load()
    header.initWatcher()
    header.cleanup()
    expect(header).toMatchObject({
      loaded: false,
      watcherInitialized: false,
      taskNotFound: false,
      date: null,
      due: null,
      dateTime: null,
      dueTime: null,
      createdAt: null,
      completedAt: null,
      recurrence: null,
      oldProps: {},
    })
    await header.load(true)
    expect(header.loaded).toBe(false)
  })

  it('can dispose a loaded header twice', async () => {
    taskHarness()
    const header = make()
    await header.load()
    header.cleanup()
    expect(() => header.cleanup()).not.toThrow()
  })

  // BUG: cleanup dereferences a null watcher before first load, and again after cleanup.
  // Disposing an unmounted/unloaded header or disposing twice throws instead of being safe.
  it('can dispose a header before its first load', () => {
    taskHarness()
    expect(() => make().cleanup()).not.toThrow()
  })

  // BUG: writes use oldProps from load, not the current parsed frontmatter. Editing a label
  // and then choosing a due date before the watcher reloads silently restores the old label.
  it.fails('preserves frontmatter edited since the header last loaded', async () => {
    const env = taskHarness({ labels: ['garden'] })
    const header = make()
    await header.load()
    env.editor.setValue(env.text().replace('garden', 'orchard'))
    await header.setDueDate(dayjs('2028-02-01'))
    expect((await parseNoteContent(env.file, env.text())).labels).toEqual(['orchard'])
  })
})
