/**
 * A task note is renamed after its first line as soon as it is typed. Its header learnt of the
 * rename through its file watcher, which is debounced — so for a moment after the rename the
 * header still pointed at the old path, found no file there, and picking a date in that moment
 * threw "Cannot read properties of null (reading 'path')" and wrote nothing.
 *
 * The header now follows the rename the moment it happens; the debounce is only for reloading.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import dayjs from 'dayjs'
import { TaskHeader } from '@/entities/TaskHeader'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { AbeleConfig } from '@/services/AbeleConfig'
import { buildFakeTaskVault, type FakeTaskVault } from '../helpers/fakeTaskVault'

// Obsidian's debounce, deferring as the real one does: the window this test is about.
vi.mock('obsidian', async (importOriginal) => {
  const original = await importOriginal<typeof import('obsidian')>()
  return {
    ...original,
    debounce: (fn: (...args: unknown[]) => unknown, wait: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      return (...args: unknown[]) => {
        clearTimeout(timer)
        timer = setTimeout(() => fn(...args), wait)
      }
    },
  }
})

const FM = ['---', "created: '2026-09-20'", 'type: task', '---', ''].join('\n')
const OLD = 'Tasks/New Task.md'
const NEW = 'Tasks/Water the plants.md'

let vault: FakeTaskVault
let renameHandlers: Array<(file: unknown, oldPath: string) => void>
let text: string

beforeEach(() => {
  vi.useFakeTimers()
  AbeleConfig.getInstance().refreshDelay = 300
  text = FM + '\nWater the plants\n'
  vault = buildFakeTaskVault({ [OLD]: text })
  renameHandlers = []
  vault.app.vault.on = (name: string, handler: (file: unknown, oldPath: string) => void) => {
    if (name === 'rename') renameHandlers.push(handler)
    return {}
  }
  vault.app.vault.offref = () => {}
  const file = vault.file(OLD)
  // The note open in its editor, which follows the file through the rename.
  vault.app.workspace.getLeavesOfType = () => [
    {
      view: {
        file,
        editor: { getValue: () => text, setValue: (value: string) => (text = value) },
      },
    },
  ]
  VaultWatcherWrapper.destroy()
})

afterEach(() => {
  VaultWatcherWrapper.destroy()
  vi.useRealTimers()
})

describe('a task header right after its note is renamed', () => {
  it('writes a date picked before the file watcher has caught up', async () => {
    const header = new TaskHeader({ id: 'h', filePath: OLD })
    await header.load()

    const file = vault.file(OLD)!
    await vault.app.fileManager.renameFile(file, NEW)
    for (const handler of renameHandlers) handler(file, OLD)

    expect(header.filePath).toBe(NEW)
    await header.setEventDate(dayjs('2026-09-30'))

    expect(text).toMatch(/date: '?2026-09-30'?/)
    expect(text).toContain('Water the plants')
    header.cleanup()
  })
})
