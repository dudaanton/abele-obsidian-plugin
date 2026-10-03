import { afterEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { TasksList } from '@/entities/TasksList'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { taskHarness, TASK_PATH } from '../helpers/taskHarness'

let list: TasksList | undefined
afterEach(() => {
  list?.cleanup()
  list = undefined
  VaultWatcherWrapper.destroy()
  vi.restoreAllMocks()
})

const start = (asReactive = false) => {
  const env = taskHarness({}, [
    { path: 'Notes/Plain.md', content: 'Plain' },
    { path: 'Tasks/Later.md', frontmatter: { type: 'note' } },
    { path: 'Wrong case.md', frontmatter: { type: 'Task' } },
    { path: 'data.txt', frontmatter: { type: 'task' } },
  ])
  list = asReactive ? (reactive(new TasksList()) as TasksList) : new TasksList()
  const resolved = () => env.app.emit('metadataCache', 'resolved')
  return { ...env, resolved }
}

describe('the vault-wide task list', () => {
  it('discovers only markdown notes of exact type task, including an empty vault', async () => {
    const env = start()
    expect([...list.tasks.keys()]).toEqual([TASK_PATH])
    expect(list.tasks.get(TASK_PATH)?.loaded).toBe(true)
    list.cleanup()
    for (const file of env.app.vault.getFiles()) await env.app.vault.delete(file)
    list = new TasksList()
    expect(list.tasks.size).toBe(0)
  })

  it('queues changed metadata until resolved and never duplicates existing tasks', () => {
    const env = start()
    const original = list.tasks.get(TASK_PATH)
    const file = env.app.vault.getFileByPath('Tasks/Later.md')!
    env.app.setFrontmatter(file.path, { type: 'task', due: '2028-02-01' })
    env.app.emit('metadataCache', 'changed', file)
    env.app.emit('metadataCache', 'changed', file)
    expect(list.tasks.size).toBe(1)
    env.resolved()
    expect(list.tasks.size).toBe(2)
    expect(list.tasks.get(TASK_PATH)).toBe(original)
    expect(list.tasks.get(file.path)?.due?.format('YYYY-MM-DD')).toBe('2028-02-01')
    env.resolved()
    expect(list.tasks.size).toBe(2)
  })

  it('revisits indexed startup paths when metadata was late, without enumerating again', () => {
    const env = start()
    env.app.setFrontmatter('Tasks/Later.md', { type: 'task' })
    env.app.resetStats()
    env.resolved()
    expect(list.tasks.has('Tasks/Later.md')).toBe(true)
    expect(env.app.stats.getMarkdownFiles).toBe(0)
    env.resolved()
    env.resolved()
    expect(env.app.stats.getMarkdownFiles).toBe(0)
  })

  it('evaluates current metadata when draining a batch, ignoring deleted notes and folders', async () => {
    const env = start()
    env.resolved()
    const file = env.app.vault.getFileByPath('Tasks/Later.md')!
    env.app.setFrontmatter(file.path, { type: 'task' })
    env.app.emit('metadataCache', 'changed', file)
    await env.app.vault.delete(file)
    env.app.emit('metadataCache', 'changed', env.app.vault.getAbstractFileByPath('Tasks'))
    env.resolved()
    expect([...list.tasks.keys()]).toEqual([TASK_PATH])
  })

  it('moves a task at resolved and disposes its old model; non-task/folder renames are ignored', async () => {
    const env = start()
    env.resolved()
    const original = list.tasks.get(TASK_PATH)!
    const clean = vi.spyOn(original, 'cleanup')
    await env.app.fileManager.renameFile(env.file, 'Archive/Basil.md')
    env.app.emit('vault', 'rename', env.file, TASK_PATH)
    expect(list.tasks.has(TASK_PATH)).toBe(true)
    env.resolved()
    expect([...list.tasks.keys()]).toEqual(['Archive/Basil.md'])
    expect(list.tasks.get('Archive/Basil.md')?.taskPath).toBe('Archive/Basil.md')
    expect(clean).toHaveBeenCalledOnce()
    expect(list.tasks.get('Archive/Basil.md')).not.toBe(original)
    env.app.emit('vault', 'rename', env.app.vault.getFileByPath('Notes/Plain.md'), 'Plain.md')
    env.app.emit('vault', 'rename', env.app.vault.getAbstractFileByPath('Tasks'), 'Old folder')
    env.resolved()
    expect(list.tasks.size).toBe(1)
  })

  it('deletes only after resolved and tolerates repeated delete events', async () => {
    const env = start()
    env.resolved()
    await env.app.vault.delete(env.file)
    env.app.emit('vault', 'delete', env.file)
    env.app.emit('vault', 'delete', env.file)
    env.app.emit('vault', 'delete', env.app.vault.getAbstractFileByPath('Tasks'))
    expect(list.tasks.size).toBe(1)
    env.resolved()
    expect(list.tasks.size).toBe(0)
  })

  it('unregisters raw event refs from both buses and clears tasks exactly once', () => {
    const env = taskHarness()
    const vaultOn = vi.spyOn(env.app.vault, 'on')
    const metadataOn = vi.spyOn(env.app.metadataCache, 'on')
    const vaultOff = vi.spyOn(env.app.vault, 'offref')
    const metadataOff = vi.spyOn(env.app.metadataCache, 'offref')
    list = reactive(new TasksList()) as TasksList
    // The singleton file watcher also registers listeners; list listeners are the final two.
    const refs = [
      ...metadataOn.mock.results.map((call) => call.value),
      ...vaultOn.mock.results.slice(-2).map((call) => call.value),
    ]
    list.cleanup()
    for (const ref of refs) {
      expect(vaultOff.mock.calls.some(([value]) => value === ref)).toBe(true)
      expect(metadataOff.mock.calls.some(([value]) => value === ref)).toBe(true)
    }
    expect(list.tasks.size).toBe(0)
    const count = vaultOff.mock.calls.length
    list.cleanup()
    expect(vaultOff.mock.calls).toHaveLength(count)
  })

  it('does not apply an already queued metadata change after cleanup', () => {
    const env = start()
    env.resolved()
    const file = env.app.vault.getFileByPath('Tasks/Later.md')!
    env.app.setFrontmatter(file.path, { type: 'task' })
    env.app.emit('metadataCache', 'changed', file)
    list.cleanup()
    // fakeVault deliberately retains listeners after offref; this exercises the guard too.
    env.resolved()
    expect(list.tasks.size).toBe(0)
  })

  it('handles a large resolved burst without rescanning the vault for each change', async () => {
    const env = start()
    env.resolved()
    env.app.resetStats()
    for (let n = 0; n < 1000; n++) {
      const path = `Tasks/Seed ${n}.md`
      const file = await env.app.vault.create(path, 'Seed')
      env.app.setFrontmatter(path, { type: 'task' })
      env.app.emit('metadataCache', 'changed', file)
    }
    env.resolved()
    expect(list.tasks.size).toBe(1001)
    expect(env.app.stats.getMarkdownFiles).toBe(0)
  })

  // BUG: changed events only add tasks; changing type from task to note never removes one.
  // A note converted away from a task remains in the sidebar until plugin reload.
  it('removes a note whose type is no longer task', () => {
    const env = start()
    env.resolved()
    env.app.setFrontmatter(TASK_PATH, { type: 'note' })
    env.app.emit('metadataCache', 'changed', env.file)
    env.resolved()
    expect(list.tasks.has(TASK_PATH)).toBe(false)
  })
})
