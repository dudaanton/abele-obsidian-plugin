import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { Task } from '@/entities/Task'
import { TaskHeader } from '@/entities/TaskHeader'
import { TaskNoteTemplate } from '@/templates/TaskNoteTemplate'
import { createTask, createTaskAndInsert } from '@/commands/createTask'
import { parseNoteContent } from '@/helpers/notesUtils'
import { AbeleConfig } from '@/services/AbeleConfig'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { gate, taskHarness, TASK_BODY, TASK_PATH } from '../helpers/taskHarness'
import type { Editor } from 'obsidian'

const models: Array<Task | TaskHeader> = []
function card() {
  const task = new Task({ wikilink: '[[Water seedlings|Alias]]' })
  models.push(task)
  return task
}
function header() {
  const task = new TaskHeader({ id: 'header', filePath: TASK_PATH })
  models.push(task)
  return task
}

beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Berlin')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2028-01-31T23:30:00+01:00'))
  AbeleConfig.getInstance().tasksFolder = 'Tasks'
  vi.spyOn(console, 'debug').mockImplementation(() => {})
})
afterEach(() => {
  for (const model of models.splice(0)) {
    if (model instanceof Task || model.watcherInitialized) model.cleanup()
  }
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('task completion in a card and in the note header', () => {
  it.each(['card', 'header'] as const)(
    '%s writes completion and undo without losing the note or its properties',
    async (surface) => {
      const env = taskHarness({
        labels: ['garden'],
        priority: 'high',
        groups: ['[[Projects/Greenhouse]]'],
        custom: { retained: true },
      })
      const task = surface === 'card' ? card() : header()
      await task.load()
      await task.toggle()
      const completed = await parseNoteContent(
        env.file,
        surface === 'card' ? await env.read() : env.text()
      )
      expect(completed).toMatchObject({
        completed: '2028-01-31',
        content: TASK_BODY,
        labels: ['garden'],
        priority: 'high',
        groups: ['[[Projects/Greenhouse]]'],
        custom: { retained: true },
      })
      expect(env.app.vault.getMarkdownFiles().map((file) => file.path)).toEqual([TASK_PATH])
      await task.toggle()
      const undone = await parseNoteContent(
        env.file,
        surface === 'card' ? await env.read() : env.text()
      )
      expect(undone).not.toHaveProperty('completed')
      expect(undone.content).toBe(TASK_BODY)
    }
  )

  it.each(['card', 'header'] as const)(
    '%s recreates interval tasks with unchecked subtasks and both next endpoints',
    async (surface) => {
      const env = taskHarness({
        date: '2028-01-29',
        due: '2028-01-30',
        dateTime: '08:00',
        dueTime: '17:00',
        recurrence: 'every 3 days',
        labels: ['garden'],
        priority: 'high',
      })
      const task = surface === 'card' ? card() : header()
      await task.load()
      await task.toggle()
      // The fake writes synchronously up to its returned Promise; no timing-dependent polling.
      const next = env.app.vault.getMarkdownFiles().find((file) => file.path !== TASK_PATH)!
      expect(next.path).toBe('Tasks/Water seedlings 2028-02-02.md')
      const data = await parseNoteContent(next, await env.read(next))
      expect(data).toMatchObject({
        date: '2028-02-01',
        due: '2028-02-02',
        dateTime: '08:00',
        dueTime: '17:00',
        created: '2028-01-01',
        recurrence: 'every 3 days',
        labels: ['garden'],
        priority: 'high',
        content: TASK_BODY.replace(/- \[x\]/gi, '- [ ]'),
      })
      expect(data).not.toHaveProperty('completed')
      expect(surface === 'card' ? await env.read() : env.text()).toContain('- [x] Tray one')
      await task.toggle()
      expect(env.app.vault.getMarkdownFiles()).toHaveLength(2)
    }
  )

  it('card recurrence from completion uses the instant just checked, not its old due date', async () => {
    const env = taskHarness({ due: '2028-01-05', recurrence: 'every 3 days from completion' })
    const task = card()
    await task.load()
    await task.toggle()
    const next = env.app.vault.getMarkdownFiles().find((file) => file.path !== TASK_PATH)!
    expect(next.path).toBe('Tasks/Water seedlings 2028-02-03.md')
    expect(await parseNoteContent(next, await env.read(next))).toMatchObject({ due: '2028-02-03' })
  })

  it('header recurrence starts from the completion just made, like the card', async () => {
    const env = taskHarness({ due: '2028-01-05', recurrence: 'every 3 days from completion' })
    const task = header()
    await task.load()
    await task.toggle()
    expect(env.app.vault.getMarkdownFiles().map((file) => file.path)).toEqual([
      TASK_PATH,
      'Tasks/Water seedlings 2028-02-03.md',
    ])
    expect(task.completedAt?.format('YYYY-MM-DD')).toBe('2028-01-31')
  })

  // BUG: TaskHeader.toggle sets only its own completedAt; its temporary Task reloads the
  // unchecked note and never receives that timestamp. Header/card clicks yield different dates.
  it('header recurrence from completion uses the date just completed', async () => {
    const env = taskHarness({ due: '2028-01-05', recurrence: 'every 3 days from completion' })
    const task = header()
    await task.load()
    await task.toggle()
    expect(env.app.vault.getMarkdownFiles().map((file) => file.path)).toContain(
      'Tasks/Water seedlings 2028-02-03.md'
    )
  })

  it.each(['card', 'header'] as const)(
    '%s advances both endpoints from the exact completion instant when requested',
    async (surface) => {
      const env = taskHarness({
        date: '2028-01-02',
        due: '2028-01-05',
        recurrence: 'every 2 hours from completion',
      })
      const task = surface === 'card' ? card() : header()
      await task.load()
      await task.toggle()
      const next = env.app.vault.getMarkdownFiles().find((file) => file.path !== TASK_PATH)!
      expect(await parseNoteContent(next, await env.read(next))).toMatchObject({
        date: '2028-02-01',
        due: '2028-02-01',
      })
      expect(task.completedAt?.format('YYYY-MM-DD HH:mm')).toBe('2028-01-31 23:30')
    }
  )

  it('header recurrence uses the editor endpoints and body rather than the persisted note', async () => {
    const env = taskHarness({ due: '2028-01-05', recurrence: 'every month', labels: ['garden'] })
    env.editor.setValue(env.text().replace('2028-01-05', '2028-01-20'))
    const task = header()
    await task.load()
    env.editor.setValue(env.text().replace('garden', 'orchard') + '\nUnsaved detail\n')
    await task.toggle()
    const next = env.app.vault.getMarkdownFiles().find((file) => file.path !== TASK_PATH)!
    expect(await parseNoteContent(next, await env.read(next))).toMatchObject({
      due: '2028-02-20',
      labels: ['orchard'],
      content: TASK_BODY.replace(/- \[x\]/gi, '- [ ]') + '\nUnsaved detail\n',
    })
  })

  it.each(['card', 'header'] as const)(
    '%s awaits creation of the next occurrence before completion resolves',
    async (surface) => {
      taskHarness({ due: '2028-01-05', recurrence: 'every day' })
      const task = surface === 'card' ? card() : header()
      await task.load()
      const pending = gate()
      const entered = gate()
      const original = TaskNoteTemplate.prototype.createNoteWithTemplate
      vi.spyOn(TaskNoteTemplate.prototype, 'createNoteWithTemplate').mockImplementation(
        async function (next, focus, overwrite) {
          if (next.taskPath !== TASK_PATH) {
            entered.release()
            await pending.promise
          }
          return original.call(this, next, focus, overwrite)
        }
      )
      let finished = false
      const completing = task.toggle().then(() => {
        finished = true
      })
      try {
        await entered.promise
        await vi.advanceTimersByTimeAsync(0)
        expect(finished).toBe(false)
      } finally {
        pending.release()
        await completing
      }
      expect(finished).toBe(true)
    }
  )

  it.each([null, '', 'not a rule'])(
    'does not duplicate a task for recurrence %j',
    async (recurrence) => {
      const env = taskHarness({ recurrence })
      const task = card()
      await task.load()
      await task.toggle()
      expect(env.app.vault.getMarkdownFiles()).toHaveLength(1)
    }
  )

  it('allows a recurrent task without either date, retaining created and choosing a collision-free path', async () => {
    const env = taskHarness({ recurrence: 'every day' })
    const task = card()
    await task.load()
    await task.toggle()
    const next = env.app.vault.getMarkdownFiles().find((file) => file.path !== TASK_PATH)!
    expect(next.path).toBe('Tasks/Water seedlings (1).md')
    const data = await parseNoteContent(next, await env.read(next))
    expect(data).not.toHaveProperty('due')
    expect(data).not.toHaveProperty('date')
    expect(data.created).toBe('2028-01-01')
  })

  it('uses an event-only recurrence date in the new name', async () => {
    const env = taskHarness({ date: '2028-01-31', recurrence: 'every month' })
    const task = card()
    await task.load()
    await task.toggle()
    expect(env.app.vault.getMarkdownFiles().map((file) => file.path)).toContain(
      'Tasks/Water seedlings 2028-02-29.md'
    )
  })

  it('does not replace the note when loading its body rejects', async () => {
    const env = taskHarness()
    const original = await env.read()
    vi.spyOn(env.app.vault, 'read').mockRejectedValueOnce(new Error('unreadable'))
    const task = card()
    await task.load()
    await expect(task.toggle()).rejects.toThrow('unreadable')
    expect(await env.read()).toBe(original)
    expect(env.app.stats.modify).toBe(0)
  })

  it('passes focus and overwrite through the file-writing surface', async () => {
    taskHarness()
    const write = vi.spyOn(TaskNoteTemplate.prototype, 'createNoteWithTemplate').mockResolvedValue()
    const task = card()
    await task.writeTaskToFile()
    expect(write).toHaveBeenLastCalledWith(task, false, true)
    await task.writeTaskToFile(true, false)
    expect(write).toHaveBeenLastCalledWith(task, true, false)
  })

  // BUG: writeTaskToFile starts createNoteWithTemplate without returning/awaiting it.
  // Callers awaiting completion/creation can observe the old file before the write finishes.
  it('awaiting a task write waits for persistence', async () => {
    taskHarness()
    const pending = gate()
    let saved = false
    vi.spyOn(TaskNoteTemplate.prototype, 'createNoteWithTemplate').mockImplementation(async () => {
      await pending.promise
      saved = true
    })
    // Let storage finish independently of its caller, including when that caller awaits it.
    queueMicrotask(pending.release)
    try {
      await card().writeTaskToFile()
      expect(saved).toBe(true)
    } finally {
      pending.release()
      await pending.promise
    }
  })
})

describe('creating task notes and inserting task links', () => {
  it('creates a default empty note with a creation date and a supplied note without losing its date', async () => {
    const env = taskHarness()
    const blank = await createTask(undefined, false)
    const supplied = await createTask(
      { title: 'Plant basil', createdAt: dayjs('2027-12-01'), content: 'Plant basil\nDetails' },
      false
    )
    expect(blank.task.taskPath).toBe('Tasks/New Task.md')
    expect(supplied.task.createdAt.format('YYYY-MM-DD')).toBe('2027-12-01')
    expect(await env.read(env.app.vault.getFileByPath('Tasks/Plant basil.md')!)).toContain(
      'Plant basil\nDetails'
    )
  })

  it.each([0, 4])('inserts at column %s and leaves the cursor after the link', async (ch) => {
    const env = taskHarness()
    const replaceRange = vi.fn()
    const setSelection = vi.fn()
    const editor = {
      getCursor: () => ({ line: 2, ch }),
      getSelection: () => '',
      replaceRange,
      setSelection,
    } as unknown as Editor
    await createTaskAndInsert(editor)
    expect(replaceRange).toHaveBeenCalledWith(
      `${ch ? '\n' : ''}- [ ] [[Tasks/New Task|New Task]]\n`,
      { line: 2, ch }
    )
    expect(setSelection).toHaveBeenCalledWith({ line: ch ? 4 : 3, ch: 0 })
    expect(env.app.vault.getFileByPath('Tasks/New Task.md')).not.toBeNull()
  })

  it('replaces a selection with a link, saving its complete multiline text as the body', async () => {
    const env = taskHarness()
    const replaceSelection = vi.fn()
    const editor = {
      getCursor: () => ({ line: 0, ch: 0 }),
      getSelection: () => 'Plant basil\nKeep moist',
      replaceSelection,
      setSelection: vi.fn(),
    } as unknown as Editor
    await createTaskAndInsert(editor)
    expect(replaceSelection).toHaveBeenCalledOnce()
    const file = env.app.vault.getMarkdownFiles().find((file) => file.path !== TASK_PATH)!
    expect(await parseNoteContent(file, await env.read(file))).toMatchObject({
      content: 'Plant basil\nKeep moist',
    })
  })

  it('does nothing without an active editor', async () => {
    const env = taskHarness()
    await createTaskAndInsert(null)
    expect(env.app.vault.getMarkdownFiles()).toHaveLength(1)
  })
})
