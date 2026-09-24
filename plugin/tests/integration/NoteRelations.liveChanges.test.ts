/**
 * A daily note that stays open while a task is made and edited elsewhere has to end up holding
 * exactly what reopening it would give — after every step, not only after the last one.
 *
 * A task made from the calendar's "+" starts with no date, so it belongs to the day it was made
 * and shows up in today's note at once. The person then names it and gives it a date. Naming it
 * renames the file (the plugin names a task note after its first line), and the date moves it
 * to another day. Both arrive together when the editor saves, and nothing orders Obsidian's
 * `changed` for the date against the plugin's rename: when the rename lands before the metadata
 * pass is over, the note used to judge the change under the new name — which it did not list —
 * and then move its entry for the old name across to the new one as it was, unjudged. The task
 * stayed in today's note until the note was opened again.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { TFile } from 'obsidian'
import { NoteRelations } from '@/entities/NoteRelations'
import { VaultWatcherWrapper } from '@/helpers/VaultWatcherWrapper'
import { useVault, dailyJournal, configureAbele } from '../helpers/testEnv'
import type { FakeFileSpec } from '../helpers/fakeVault'

const TODAY = 'Journals/2026/2026-08-22.md'
const NEW_TASK = 'Tasks/New Task.md'
const NAMED = 'Tasks/Water the plants.md'

const VAULT: FakeFileSpec[] = [
  { path: TODAY, frontmatter: { type: 'journal' }, content: 'Today\n' },
  {
    path: 'Tasks/Already today.md',
    frontmatter: { type: 'task', created: '2026-08-01', date: '2026-08-22' },
    content: 'Already today\n',
  },
  // Just made from the calendar's "+": no date yet, so it belongs to the day it was made.
  { path: NEW_TASK, frontmatter: { type: 'task', created: '2026-08-22' }, content: '' },
]

describe('NoteRelations — an open daily note follows a task through its first edits', () => {
  let app: ReturnType<typeof useVault>
  let relations: NoteRelations | null = null

  beforeEach(() => {
    app = useVault(VAULT)
    configureAbele({ journals: [dailyJournal()] })
  })

  afterEach(() => {
    relations?.cleanup()
    relations = null
    VaultWatcherWrapper.destroy()
  })

  const fileAt = (path: string) => app.vault.getAbstractFileByPath(path) as TFile
  const changed = (file: TFile) => app.emit('metadataCache', 'changed', file)
  const resolved = () => app.emit('metadataCache', 'resolved')
  const rename = async (file: TFile, to: string) => {
    const from = file.path
    await app.fileManager.renameFile(file, to)
    app.emit('vault', 'rename', file, from)
  }
  const listed = () => [...relations!.tasks.keys()].sort()
  const reopened = () => {
    const fresh = new NoteRelations(TODAY)
    const tasks = [...fresh.tasks.keys()].sort()
    fresh.cleanup()
    return tasks
  }

  it('lists the undated task the moment it is made, as reopening would', () => {
    relations = new NoteRelations(TODAY)
    expect(listed()).toEqual(reopened())
    expect(listed()).toContain(NEW_TASK)
  })

  it('lets go of it when the date and the rename arrive before the metadata pass ends', async () => {
    relations = new NoteRelations(TODAY)
    const file = fileAt(NEW_TASK)

    // One editor save carries the name and the date: Obsidian parses it and reports the
    // change, the plugin renames the note after its new first line, and only then does the
    // metadata pass finish.
    app.setFrontmatter(NEW_TASK, { type: 'task', created: '2026-08-22', date: '2026-08-25' })
    changed(file)
    await rename(file, NAMED)
    resolved()

    expect(listed()).toEqual(reopened())
    expect(listed()).not.toContain(NAMED)
    expect(listed()).not.toContain(NEW_TASK)
  })

  it('lets go of it when the rename is reported before the date', async () => {
    relations = new NoteRelations(TODAY)
    const file = fileAt(NEW_TASK)

    app.setFrontmatter(NEW_TASK, { type: 'task', created: '2026-08-22', date: '2026-08-25' })
    await rename(file, NAMED)
    changed(file)
    resolved()

    expect(listed()).toEqual(reopened())
    expect(listed()).not.toContain(NAMED)
  })

  it('keeps it, under its new name, when it is only named and stays undated', async () => {
    relations = new NoteRelations(TODAY)
    const file = fileAt(NEW_TASK)

    changed(file)
    await rename(file, NAMED)
    resolved()

    expect(listed()).toEqual(reopened())
    expect(listed()).toContain(NAMED)
    expect(listed()).not.toContain(NEW_TASK)
  })

  it('does not take in a renamed task that never belonged', async () => {
    app.setFrontmatter(NEW_TASK, { type: 'task', created: '2026-08-22', date: '2026-08-25' })
    relations = new NoteRelations(TODAY)
    expect(listed()).not.toContain(NEW_TASK)

    await rename(fileAt(NEW_TASK), NAMED)
    resolved()

    expect(listed()).toEqual(reopened())
  })

  it('judges a listed task again on every change, taking it out and back in', () => {
    relations = new NoteRelations(TODAY)
    const file = fileAt(NEW_TASK)

    const steps: [Record<string, unknown>, boolean][] = [
      [{ type: 'task', created: '2026-08-22', date: '2026-08-25' }, false],
      [{ type: 'task', created: '2026-08-22' }, true],
      [{ type: 'task', created: '2026-08-22', due: '2026-08-30' }, false],
      [{ type: 'task', created: '2026-08-22', due: '2026-08-22' }, true],
      [{ type: 'task', created: '2026-08-22', date: '2026-08-22', due: '2026-08-27' }, false],
    ]

    for (const [frontmatter, belongs] of steps) {
      app.setFrontmatter(NEW_TASK, frontmatter)
      changed(file)
      resolved()

      expect(listed()).toEqual(reopened())
      expect(listed().includes(NEW_TASK)).toBe(belongs)
    }
  })

  it('keeps judging the rest of a batch when one change in it cannot be judged', () => {
    relations = new NoteRelations(TODAY)
    const file = fileAt(NEW_TASK)

    // Something in the same metadata pass that throws when looked at.
    const broken = {
      get path(): string {
        throw new Error('unreadable')
      },
    } as unknown as TFile

    app.setFrontmatter(NEW_TASK, { type: 'task', created: '2026-08-22', date: '2026-08-25' })
    changed(broken)
    changed(file)
    resolved()

    expect(listed()).toEqual(reopened())
    expect(listed()).not.toContain(NEW_TASK)
  })
})
