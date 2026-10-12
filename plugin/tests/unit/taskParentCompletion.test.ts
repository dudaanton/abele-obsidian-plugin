import { afterEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { Task } from '@/entities/Task'
import { TaskHeader } from '@/entities/TaskHeader'
import { TasksList } from '@/entities/TasksList'
import { GlobalStore } from '@/stores/GlobalStore'
import { AUTO_COMPLETED } from '@/commands/taskCompletion'
import { useVault } from '../helpers/testEnv'
import { taskHarness, TASK_PATH } from '../helpers/taskHarness'

let list: TasksList | undefined
afterEach(() => {
  list?.cleanup()
  list = undefined
  GlobalStore.getInstance().tasksList.value = null
})

const setup = (
  specs: { name: string; groups?: string[]; completed?: string; automatic?: boolean }[]
) => {
  const app = useVault(
    specs.map((s) => ({
      path: `Tasks/${s.name}.md`,
      content: `${s.name}\n\nSample body remains.`,
      frontmatter: {
        type: 'task',
        groups: s.groups ?? [],
        ...(s.completed ? { completed: s.completed } : {}),
        ...(s.automatic ? { [AUTO_COMPLETED]: s.completed } : {}),
      },
    }))
  )
  list = new TasksList()
  GlobalStore.getInstance().tasksList.value = list
  const tasks = specs.map(
    (s) =>
      new Task({
        wikilink: `[[Tasks/${s.name}]]`,
        oldProps: {
          groups: s.groups ?? [],
          ...(s.automatic ? { [AUTO_COMPLETED]: s.completed } : {}),
        },
        completedAt: s.completed ? dayjs(s.completed) : undefined,
        content: `${s.name}\n\nSample body remains.`,
      })
  )
  for (const task of tasks) list.tasks.set(task.taskPath, task)
  return { app, tasks }
}

describe('persisted parent completion', () => {
  it('keeps unsaved parent text and properties in its open editor on close and reopen', async () => {
    const harness = taskHarness({}, [
      {
        path: 'Tasks/Sample child.md',
        frontmatter: { type: 'task', groups: [`[[${TASK_PATH}]]`] },
        content: 'Sample child body',
      },
    ])
    const original = await harness.read()
    harness.editor.setValue(
      harness.text().replace('type: task', 'type: task\nsampleFlag: retained') +
        '\nSample unsaved body.'
    )
    list = new TasksList()
    GlobalStore.getInstance().tasksList.value = list
    const parent = new Task({ wikilink: `[[${TASK_PATH}]]` })
    const child = new Task({
      wikilink: '[[Tasks/Sample child]]',
      content: 'Sample child body',
      oldProps: { groups: [`[[${TASK_PATH}]]`] },
    })
    list.tasks.set(parent.taskPath, parent)
    list.tasks.set(child.taskPath, child)
    await child.toggle()
    expect(harness.text()).toContain('abeleAutoCompleted:')
    expect(harness.text()).not.toContain('content:')
    await child.toggle()
    expect(harness.text()).not.toContain('completed:')
    expect(harness.text()).toContain('sampleFlag: retained')
    expect(harness.text()).toContain('Sample unsaved body.')
    expect(await harness.read()).toBe(original)
    harness.close()
  })
  it('does not close a parent when persisting the child fails', async () => {
    const {
      tasks: [parent, child],
    } = setup([{ name: 'Sample parent' }, { name: 'Sample child', groups: ['[[Sample parent]]'] }])
    vi.spyOn(child, 'writeTaskToFile').mockRejectedValue(new Error('Sample write failure'))
    await expect(child.toggle()).rejects.toThrow('Sample write failure')
    expect(parent.completedAt).toBeNull()
  })

  it('does not reopen a parent whose persisted completion was manually replaced', async () => {
    const {
      app,
      tasks: [parent, child],
    } = setup([
      { name: 'Sample parent', completed: '2030-01-01', automatic: true },
      { name: 'Sample child', groups: ['[[Sample parent]]'], completed: '2030-01-01' },
    ])
    const file = app.vault.getFileByPath(parent.taskPath)!
    await app.fileManager.processFrontMatter(file, (fm) => {
      fm.completed = '2030-01-02'
      delete fm[AUTO_COMPLETED]
    })
    // The indexed entity has not caught up with that edit yet.
    parent.completedAt = dayjs('2030-01-01')
    parent.oldProps[AUTO_COMPLETED] = '2030-01-01'
    await child.toggle()
    expect(await app.vault.read(file)).toContain('2030-01-02')
  })
  it('waits for the last child, cascades up and reopens both automatic ancestors on untick', async () => {
    const {
      app,
      tasks: [top, parent, first, last],
    } = setup([
      { name: 'Sample top' },
      { name: 'Sample parent', groups: ['[[Sample top]]'] },
      { name: 'Sample first', groups: ['[[Sample parent]]'] },
      { name: 'Sample last', groups: ['[[Sample parent]]'] },
    ])
    await first.toggle()
    expect(parent.completedAt).toBeNull()
    await last.toggle()
    expect(parent.completedAt).not.toBeNull()
    expect(top.completedAt).not.toBeNull()
    for (const task of [parent, top]) {
      const text = await app.vault.read(app.vault.getFileByPath(task.taskPath)!)
      expect(text).toContain('abeleAutoCompleted:')
      expect(text).toContain('Sample body remains.')
    }
    // Reload metadata: reopening depends on persisted provenance, not an in-memory history.
    await parent.load(true)
    await top.load(true)
    await last.toggle()
    expect(parent.completedAt).toBeNull()
    expect(top.completedAt).toBeNull()
    for (const task of [parent, top]) {
      expect(await app.vault.read(app.vault.getFileByPath(task.taskPath)!)).not.toContain(
        'completed:'
      )
      expect(task.oldProps[AUTO_COMPLETED]).toBeUndefined()
    }
  })

  it('keeps a manually completed parent closed when its child is unticked', async () => {
    const {
      tasks: [parent, child],
    } = setup([
      { name: 'Sample parent', completed: '2030-01-01' },
      { name: 'Sample child', groups: ['[[Sample parent]]'], completed: '2030-01-01' },
    ])
    await child.toggle()
    expect(parent.completedAt?.format('YYYY-MM-DD')).toBe('2030-01-01')
  })

  it('clears automatic provenance when the parent is explicitly reticked', async () => {
    const {
      tasks: [parent, child],
    } = setup([
      { name: 'Sample parent', completed: '2030-01-01', automatic: true },
      { name: 'Sample child', groups: ['[[Sample parent]]'], completed: '2030-01-01' },
    ])
    await parent.toggle()
    await parent.toggle()
    expect(parent.oldProps[AUTO_COMPLETED]).toBeUndefined()
    await child.toggle()
    expect(parent.completedAt).not.toBeNull()
  })

  it('does not automatically close circular tasks or their external parent', async () => {
    const {
      tasks: [top, a, b],
    } = setup([
      { name: 'Sample top' },
      { name: 'Sample first', groups: ['[[Sample second]]', '[[Sample top]]'] },
      { name: 'Sample second', groups: ['[[Sample first]]'] },
    ])
    await a.toggle()
    expect(b.completedAt).toBeNull()
    expect(top.completedAt).toBeNull()
    await b.toggle()
    expect(top.completedAt).toBeNull()
  })

  it('propagates a header toggle from its temporary entity to the indexed parent', async () => {
    const harness = taskHarness({ groups: ['[[Sample parent]]'] }, [
      {
        path: 'Tasks/Sample parent.md',
        frontmatter: { type: 'task' },
        content: 'Sample parent body',
      },
    ])
    list = new TasksList()
    GlobalStore.getInstance().tasksList.value = list
    const parent = new Task({ wikilink: '[[Tasks/Sample parent]]' })
    list.tasks.set(parent.taskPath, parent)
    const header = new TaskHeader({ id: 'sample-header', filePath: TASK_PATH })
    try {
      await header.load()
      await header.toggle()
      expect(parent.completedAt).not.toBeNull()
      await header.toggle()
      expect(parent.completedAt).toBeNull()
    } finally {
      header.cleanup()
      harness.close()
    }
  })
})
