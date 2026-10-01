import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Task } from '@/entities/Task'
import { AbeleConfig } from '@/services/AbeleConfig'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { taskHarness, TASK_BODY, TASK_PATH } from '../helpers/taskHarness'
import { getBacklinksByPath } from '@/helpers/vaultUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { flushPromises } from '@vue/test-utils'

const models: Task[] = []
const make = (wikilink = '[[Water seedlings|Alias]]', filePath?: string) => {
  const task = new Task({ id: 'card', wikilink, filePath })
  models.push(task)
  return task
}
beforeEach(() => {
  vi.stubEnv('TZ', 'Europe/Berlin')
  AbeleConfig.getInstance().taskLabelProperty = 'labels'
})
afterEach(() => {
  models.splice(0).forEach((task) => task.cleanup())
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('naming when a note first becomes a typed entity', () => {
  // BUG: the vault modify event still sees the old type before metadata is parsed.
  it.each([
    ['task', 'Tasks/Sample renamed title.md'],
    ['transaction', 'Ledger/2028-03-01 Sample renamed title.md'],
  ])('handles the first edit assigning type %s', async (type, expectedPath) => {
    const env = taskHarness({ type: 'note' })
    const config = AbeleConfig.getInstance()
    const oldFolder = config.tasksFolder
    const oldTemplate = config.transactionPathTemplate
    config.tasksFolder = 'Tasks'
    config.transactionPathTemplate = 'Ledger/{{date}} {{title}}'
    const store = GlobalStore.getInstance()
    store.initialized.value = false
    store.init(env.app)
    try {
      const saved = `---\ntype: ${type}\ndate: '2028-03-01'\n---\nSample renamed title\n`
      await env.app.vault.modify(env.file, saved)
      env.app.emit('vault', 'modify', env.file)
      await flushPromises()
      expect(env.file.path).toBe(TASK_PATH)
      env.app.setFrontmatter(env.file.path, { type, date: '2028-03-01' })
      env.app.emit('metadataCache', 'changed', env.file)
      await flushPromises()
      expect(env.file.path).toBe(expectedPath)
      expect(await env.app.vault.read(env.file)).toBe(saved)
      const off = vi.spyOn(env.app.metadataCache, 'offref')
      store.destroy()
      expect(off).toHaveBeenCalledOnce()
      env.app.resetStats()
      env.app.emit('metadataCache', 'changed', env.file)
      await flushPromises()
      expect(env.app.stats.read).toBe(0)
    } finally {
      store.destroy()
      config.tasksFolder = oldFolder
      config.transactionPathTemplate = oldTemplate
    }
  })
})

describe('Task load, lazy body and watcher lifecycle', () => {
  it('loads cache dates, times, labels and priority without reading the body', async () => {
    const env = taskHarness({
      date: '2028-01-31',
      dateTime: '08:45',
      due: '2028-02-01',
      dueTime: '17:30',
      completed: '2028-02-02',
      recurrence: 'every week',
      priority: 'HIGH',
      labels: ['garden', ' garden ', 'tools'],
      scheduled: '2028-03-01',
      start: '2028-04-01',
    })
    const task = make()
    await task.load()
    expect(task.loaded).toBe(true)
    expect(task.watcherInitialized).toBe(true)
    expect(task.taskNotFound).toBe(false)
    expect(task.taskPath).toBe(TASK_PATH)
    expect(task.taskName).toBe('Water seedlings')
    expect(task.taskFolder).toBe('Tasks')
    expect(task.title).toBe('')
    expect(env.app.stats.read).toBe(0)
    expect(task.date.format('YYYY-MM-DD HH:mm')).toBe('2028-01-31 08:45')
    expect(task.due.format('YYYY-MM-DD HH:mm')).toBe('2028-02-01 17:30')
    expect(task.createdAt.format('YYYY-MM-DD')).toBe('2028-01-01')
    expect(task.completedAt.format('YYYY-MM-DD')).toBe('2028-02-02')
    expect(task.priority).toBe('high')
    expect(task.labels).toEqual(['garden', 'tools'])
    expect(task.oldProps).toMatchObject({
      scheduled: '2028-03-01',
      start: '2028-04-01',
      content: undefined,
    })
    await task.loadContent()
    expect(task.title).toBe('Water seedlings')
    expect(task.description).toBe('- [x] Tray one\n- [X] Tray two\n- [ ] Tray three')
    expect(task.content).toBe(TASK_BODY)
    expect(task.toCreateDTO()).toMatchObject({
      title: task.title,
      description: task.description,
      date: task.date,
      dateTime: task.dateTime,
      due: task.due,
      dueTime: task.dueTime,
      createdAt: task.createdAt,
      completedAt: task.completedAt,
      recurrence: 'every week',
      content: TASK_BODY,
      oldProps: task.oldProps,
    })
  })

  it('uses configured labels immediately and preserves unrelated scheduling properties without interpreting them', async () => {
    taskHarness({
      labels: 'garden',
      tags: ['seedlings'],
      scheduled: '2028-02-01',
      start: '2028-01-30',
    })
    const task = make()
    await task.load()
    expect(task.labels).toEqual(['garden'])
    AbeleConfig.getInstance().taskLabelProperty = 'tags'
    expect(task.labels).toEqual(['seedlings'])
    AbeleConfig.getInstance().taskLabelProperty = ''
    expect(task.labels).toEqual(['garden'])
    expect(task.dates).toEqual([])
    expect(task.getTaskDate()?.format('YYYY-MM-DD')).toBe('2028-01-01')
  })

  it('skips repeated load, reloads when forced, and clears removed fields', async () => {
    const env = taskHarness({ due: '2028-02-01', priority: 'high' })
    const task = make()
    await task.load()
    env.app.setFrontmatter(TASK_PATH, {
      type: 'task',
      date: 'not-a-date',
      dueTime: '12:00',
      priority: 'unknown',
    })
    await task.load()
    expect(task.due).not.toBeNull()
    await task.load(true)
    expect(task.due).toBeNull()
    expect(task.dueTime).toBeNull()
    expect(task.createdAt).toBeNull()
    expect(task.date).toBeNull()
    expect(task.priority).toBeNull()
  })

  it('names a blank body New Task, preserving the original whitespace', async () => {
    const env = taskHarness()
    await env.app.vault.modify(env.file, '---\ntype: task\n---\n\n \n')
    const task = make()
    await task.loadContent()
    expect(task.title).toBe('New Task')
    expect(task.description).toBe('')
    expect(task.content).toBe('\n \n')
  })

  it('marks missing metadata or file as not found without throwing', async () => {
    taskHarness({}, [{ path: 'Plain.md', content: 'Plain body' }])
    const plain = make('[[Plain]]')
    await plain.load()
    expect(plain.taskNotFound).toBe(true)
    const missing = make('[[Missing]]')
    await missing.load()
    await missing.loadContent()
    expect(missing.loaded).toBe(true)
    expect(missing.taskNotFound).toBe(true)
    expect(missing.taskPath).toBe('Missing.md')
    expect(missing.taskFolder).toBe('')
  })

  it('follows a move and reloads subsequent edits at the new path', async () => {
    const env = taskHarness()
    const task = make()
    await task.load()
    const moved = 'Archive/Basil.md'
    await env.app.fileManager.renameFile(env.file, moved)
    env.app.emit('vault', 'rename', env.file, TASK_PATH)
    expect(task.taskPath).toBe(moved)
    expect(task.taskName).toBe('Basil')
    expect(task.taskFolder).toBe('Archive')
    env.app.setFrontmatter(moved, { type: 'task', due: '2028-02-10' })
    await env.app.vault.modify(env.file, '---\ntype: task\n---\nBasil\nFresh body')
    const loaded = vi.spyOn(task, 'loadContent')
    env.app.emit('vault', 'modify', env.file)
    await loaded.mock.results[0].value
    expect(task.title).toBe('Basil')
    expect(task.description).toBe('Fresh body')
    expect(task.due.format('YYYY-MM-DD')).toBe('2028-02-10')
  })

  // BUG: VaultWatcherWrapper dispatches delete without file, but FileWatcher requires a
  // TFile in that field. A deleted task's existing card never switches to "Task not found".
  it('marks a deleted task missing through its watcher', async () => {
    const env = taskHarness()
    const task = make()
    await task.load()
    await env.app.vault.delete(env.file)
    vi.spyOn(env.app.metadataCache, 'getFirstLinkpathDest').mockReturnValue(null)
    env.app.emit('vault', 'delete', env.file)
    expect(task.taskNotFound).toBe(true)
  })

  it('cleanup resets every field and prevents reloading', async () => {
    const env = taskHarness({ due: '2028-02-01', priority: 'high' })
    const task = make()
    await task.load()
    await task.loadContent()
    task.cleanup()
    task.cleanup()
    expect(task.toCreateDTO()).toEqual({
      title: '',
      description: '',
      createdAt: null,
      completedAt: null,
      date: null,
      dateTime: null,
      due: null,
      dueTime: null,
      recurrence: null,
      content: '',
      oldProps: {},
    })
    expect(task.priority).toBeNull()
    expect(task.watcherInitialized).toBe(false)
    env.app.resetStats()
    await task.load(true)
    expect(task.loaded).toBe(false)
    expect(env.app.stats.getFileCache).toBe(0)
  })

  // BUG: successful load/loadContent never resets taskNotFound. A missing link remains
  // "Task not found" after its note is created and the entity is explicitly refreshed.
  it('clears missing state when its body can be read again', async () => {
    const env = taskHarness()
    const task = make('[[sample-recovered]]')
    await task.loadContent()
    expect(task.taskNotFound).toBe(true)
    await env.app.vault.create('sample-recovered.md', 'Recovered body')
    await task.loadContent()
    expect(task.taskNotFound).toBe(false)
    expect(task.content).toBe('Recovered body')
  })

  it('recovers from a temporarily missing metadata cache', async () => {
    const env = taskHarness()
    const cache = vi.spyOn(env.app.metadataCache, 'getFileCache').mockReturnValueOnce(null)
    const task = make()
    await task.load()
    expect(task.taskNotFound).toBe(true)
    cache.mockRestore()
    await task.load(true)
    expect(task.taskNotFound).toBe(false)
  })
})

describe('removing task links and notes', () => {
  it('removes all supported embeds from open editors and closed files, preserving other links', async () => {
    const embeds = [
      'Tasks/Water seedlings',
      'Tasks/Water seedlings|Alias',
      'Water seedlings',
      'Water seedlings|Alias',
    ]
      .map((link) => `- [ ] [[${link}]]`)
      .join('\n')
    const body = `Before\n\n${embeds}\n\nAfter\n[[Water seedlings]]\n- [x] [[Water seedlings]]`
    const env = taskHarness({}, [
      { path: 'Open.md', content: body },
      { path: 'Closed.md', content: body },
      { path: 'Unchanged.md', content: '[[Water seedlings]]' },
    ])
    let openText = body + '\nUnsaved words'
    const setValue = vi.fn((value: string) => {
      openText = value
    })
    vi.spyOn(env.app.workspace, 'getLeavesOfType').mockReturnValue([
      {
        view: {
          file: env.app.vault.getFileByPath('Open.md'),
          editor: { getValue: () => openText, setValue },
        },
      },
    ] as never)
    // Force a fresh backlink index for this app; this is the same lookup removal uses.
    expect(getBacklinksByPath(TASK_PATH)).toContain('Closed.md')
    const task = make()
    await task.load()
    const trash = vi.spyOn(env.app.fileManager, 'trashFile')
    await task.remove()
    const expected = 'Before\n\nAfter\n[[Water seedlings]]\n- [x] [[Water seedlings]]'
    expect(openText).toBe(expected + '\nUnsaved words')
    expect(await env.read(env.app.vault.getFileByPath('Closed.md')!)).toBe(expected)
    expect(await env.read(env.app.vault.getFileByPath('Open.md')!)).toBe(body)
    expect(await env.read(env.app.vault.getFileByPath('Unchanged.md')!)).toBe('[[Water seedlings]]')
    expect(trash).toHaveBeenCalledWith(env.file)
    expect(env.app.vault.getFileByPath(TASK_PATH)).toBeNull()
    expect(task.loaded).toBe(false)
  })

  it('removes an orphan only from its live source editor and avoids redundant writes', () => {
    const env = taskHarness()
    env.editor.setValue('Before\n\n- [ ] [[Missing|Alias]]\n\nAfter')
    const set = vi.spyOn(env.editor, 'setValue')
    const task = make('[[Missing|Alias]]', TASK_PATH)
    task.removeOrphanedLink()
    expect(env.text()).toBe('Before\n\nAfter')
    expect(set).toHaveBeenCalledOnce()
    task.removeOrphanedLink()
    expect(set).toHaveBeenCalledOnce()
    env.close()
    expect(() => task.removeOrphanedLink()).not.toThrow()
    expect(() => make('[[Missing]]').removeOrphanedLink()).not.toThrow()
    expect(() => make('[[Missing]]', 'No source.md').removeOrphanedLink()).not.toThrow()
  })

  it('can remove a missing task without attempting to trash it', async () => {
    const env = taskHarness()
    const trash = vi.spyOn(env.app.fileManager, 'trashFile')
    await make('[[Missing]]').remove()
    expect(trash).not.toHaveBeenCalled()
  })
})
