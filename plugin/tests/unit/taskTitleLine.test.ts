/**
 * A task note is named after its first line: the line is the title, the file name follows it.
 * A note whose name was set some other way — by hand, by a sync, by whoever wrote the file —
 * and whose text opens with something else is renamed after that text, and the text is left
 * exactly as it is. The plugin never writes the name into the text: doing so would put a line
 * above the reader's own first line, and on the next write that line would name the note.
 *
 * Ticking such a task off rewrites its frontmatter and puts the body back under it, byte for
 * byte, blank line after the frontmatter included.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Task } from '@/entities/Task'
import { syncTaskFileName } from '@/helpers/taskFileName'
import { AbeleConfig } from '@/services/AbeleConfig'
import { buildFakeTaskVault, type FakeTaskVault } from '../helpers/fakeTaskVault'

const FM = '---\ntype: task\ncreated: 2026-09-20\n---\n'
const BODY = '\nPick up the organic one from the corner shop.\n\nIt closes at eight.\n'

/** Writes as Obsidian does, and waits for whatever the write set going to settle. */
function writable(vault: FakeTaskVault): FakeTaskVault {
  vault.app.vault.modify = async (file: { path: string }, content: string) => {
    vault.write(file.path, content)
  }
  vault.app.vault.createFolder = async () => {}
  vault.app.vault.on = () => ({})
  vault.app.vault.offref = () => {}
  return vault
}

const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  AbeleConfig.getInstance().tasksFolder = 'Tasks'
})

describe('a task whose text opens with something other than its name', () => {
  it('is renamed after its first line, and its text is not touched', async () => {
    const vault = buildFakeTaskVault({ 'Tasks/Buy milk.md': FM + BODY })

    await syncTaskFileName(vault.app, vault.file('Tasks/Buy milk.md')!)

    expect(vault.paths()).toEqual(['Tasks/Pick up the organic one from the corner shop..md'])
    expect(vault.content('Tasks/Pick up the organic one from the corner shop..md')).toBe(FM + BODY)
  })

  it('keeps its text and the blank line under the frontmatter when ticked off', async () => {
    const vault = writable(buildFakeTaskVault({ 'Tasks/Buy milk.md': FM + BODY }))
    const task = new Task({ wikilink: '[[Tasks/Buy milk]]' })
    await task.load()

    await task.toggle()
    await settle()

    const written = vault.content('Tasks/Buy milk.md')
    expect(written).toMatch(/^---\n[\s\S]*completed: '\d{4}-\d{2}-\d{2}'\n---\n/)
    expect(written.slice(written.indexOf('\n---\n') + 5)).toBe(BODY)
    expect(written).not.toContain('Buy milk')
    task.cleanup()
  })

  it('keeps a text glued to the frontmatter glued, and adds no title above it', async () => {
    const glued = 'Pick up the organic one.\n'
    const vault = writable(buildFakeTaskVault({ 'Tasks/Buy milk.md': FM + glued }))
    const task = new Task({ wikilink: '[[Tasks/Buy milk]]' })
    await task.load()

    await task.toggle()
    await settle()

    const written = vault.content('Tasks/Buy milk.md')
    expect(written).toContain('completed:')
    expect(written.slice(written.indexOf('\n---\n') + 5)).toBe(glued)
    task.cleanup()
  })
})

// A task embedded under another name — `![[Tasks/Buy milk|Milk]]` — was written back to a note
// named after the alias: ticking it made `Tasks/Milk.md` with a copy of the text and left the
// real one unticked.
describe('a task linked under an alias', () => {
  it('is ticked in its own note, and no copy is made under the alias', async () => {
    const vault = writable(buildFakeTaskVault({ 'Tasks/Buy milk.md': FM + BODY }))
    vault.app.vault.create = async (path: string) => {
      throw new Error(`created ${path}`)
    }
    const task = new Task({ wikilink: '[[Tasks/Buy milk|Milk]]' })
    await task.load()

    await task.toggle()
    await settle()

    expect(vault.paths()).toEqual(['Tasks/Buy milk.md'])
    expect(vault.content('Tasks/Buy milk.md')).toContain('completed:')
    task.cleanup()
  })
})
