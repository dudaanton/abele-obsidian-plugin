/**
 * Ticking a task off on a phone renamed it "New Task.md" — and a second one "New Task (1).md".
 * A task is renamed after its first line, and "New Task" is what an empty text is called: the
 * rename had read the note as empty. It read it from the note's open editor rather than from
 * the file the change was written to, and an editor that has not loaded its text — a tab in the
 * background, a note shown in reading view — answers with nothing.
 *
 * The rename now reads the file, keeps the name when the text names nothing, and treats a name
 * that is the first line as the file system stores it — without the dots at its end, which some
 * file systems drop — as that line's own.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Task } from '@/entities/Task'
import { pathToWikilink } from '@/helpers/pathsHelpers'
import { syncTaskFileName, taskFileTarget } from '@/helpers/taskFileName'
import { AbeleConfig } from '@/services/AbeleConfig'
import { buildFakeTaskVault, type FakeTaskVault } from '../helpers/fakeTaskVault'

const FM = [
  '---',
  "created: '2026-09-20'",
  'type: task',
  'agentic-task-status: review',
  'groups:',
  "  - '[[Agent/Abele/Abele Plugin]]'",
  '---',
  '',
].join('\n')

const CHATS = 'Agent/Abele/Tasks/У abele-chats-list__chats..md'
const CHATS_TEXT = '\nУ abele-chats-list__chats.\n\nчто-то было не так с этим селектором\n'
const TIMEOUT = 'Agent/Abele/Tasks/Гибкие настройки загрузки файлов и обычных запросов любой timeout..md'
const TIMEOUT_TEXT = '\nГибкие настройки загрузки файлов и обычных запросов: любой timeout.\n\nПодробности.\n'

/** Writes as Obsidian does, firing the modify event the rename listens to. */
function live(vault: FakeTaskVault): FakeTaskVault {
  vault.app.vault.modify = async (file: { path: string }, content: string) => {
    vault.write(file.path, content)
    await vault.onModify?.(vault.file(file.path)!)
  }
  vault.app.vault.createFolder = async () => {}
  vault.app.vault.create = async (path: string) => {
    throw new Error(`created ${path}`)
  }
  vault.app.vault.on = () => ({})
  vault.app.vault.offref = () => {}
  vault.onModify = (file) => syncTaskFileName(vault.app, file)
  return vault
}

/** The note open in a tab whose editor has not loaded its text. */
function openWithEmptyEditor(vault: FakeTaskVault, path: string) {
  vault.app.workspace.getLeavesOfType = () => [
    { view: { file: vault.file(path), editor: { getValue: () => '' } } },
  ]
}

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  AbeleConfig.getInstance().tasksFolder = 'Agent/Abele/Tasks'
})

describe('a task named after its first line keeps its name', () => {
  it.each([
    [CHATS, CHATS_TEXT],
    [TIMEOUT, TIMEOUT_TEXT],
  ])('%s', async (path, text) => {
    const vault = buildFakeTaskVault({ [path]: FM + text })
    expect(await taskFileTarget(vault.app, vault.file(path)!)).toBeNull()
  })

  it('when the file system dropped the dot at the end of the name', async () => {
    const path = 'Agent/Abele/Tasks/У abele-chats-list__chats.md'
    const vault = buildFakeTaskVault({ [path]: FM + CHATS_TEXT })
    expect(await taskFileTarget(vault.app, vault.file(path)!)).toBeNull()
  })

  it('when its open editor has not loaded the text', async () => {
    const vault = buildFakeTaskVault({ [CHATS]: FM + CHATS_TEXT })
    openWithEmptyEditor(vault, CHATS)
    expect(await taskFileTarget(vault.app, vault.file(CHATS)!)).toBeNull()
  })

  it('when its text is empty: nothing names it anything else', async () => {
    const vault = buildFakeTaskVault({ [CHATS]: FM })
    expect(await taskFileTarget(vault.app, vault.file(CHATS)!)).toBeNull()
  })

  it('and still follows a first line that really changed', async () => {
    const vault = buildFakeTaskVault({ [CHATS]: FM + '\nУбрать отступ у списка чатов\n' })
    expect(await taskFileTarget(vault.app, vault.file(CHATS)!)).toBe(
      'Agent/Abele/Tasks/Убрать отступ у списка чатов.md'
    )
  })
})

describe('ticking such a task off', () => {
  it.each([
    [CHATS, CHATS_TEXT],
    [TIMEOUT, TIMEOUT_TEXT],
  ])('%s: renames nothing and keeps the text and properties', async (path, text) => {
    const vault = live(buildFakeTaskVault({ [path]: FM + text }))
    openWithEmptyEditor(vault, path)
    const task = new Task({ wikilink: pathToWikilink(path) })
    await task.load()

    await task.toggle()
    await settle()

    expect(vault.renames).toEqual([])
    expect(vault.paths()).toEqual([path])
    const written = vault.content(path)
    expect(written).toContain('completed:')
    expect(written).toContain('agentic-task-status: review')
    expect(written).toContain('Agent/Abele/Abele Plugin')
    expect(written.slice(written.indexOf('\n---\n') + 5)).toBe(text)
    task.cleanup()
  })

  it('writes nothing when the note could not be read, rather than an empty one', async () => {
    const vault = live(buildFakeTaskVault({ [CHATS]: FM + CHATS_TEXT }))
    const task = new Task({ wikilink: pathToWikilink(CHATS) })
    await task.load()
    vault.app.vault.read = async () => {
      throw new Error('not readable')
    }
    vault.app.vault.cachedRead = vault.app.vault.read

    await task.toggle().catch(() => {})
    await settle()

    expect(vault.content(CHATS)).toBe(FM + CHATS_TEXT)
    expect(vault.renames).toEqual([])
    task.cleanup()
  })
})
