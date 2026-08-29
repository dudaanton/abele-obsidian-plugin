/**
 * Names that cannot be linked to are refused before the note exists.
 *
 * A script derived a note's name from a markdown heading and left the `#` on the front.
 * `vault.create` took it without a word — Obsidian only refuses such names in its own new-file
 * dialog — and out came a note that no wikilink can reach, because `[[Note#x]]` addresses a
 * heading rather than a file. The check therefore lives where the writing happens, and covers
 * every way in: an agent's tool call and a script's `create`, `move` and `copy` alike.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createCreateFileTool } from '@/ai/tools/CreateFileTool'
import { createMoveFileTool } from '@/ai/tools/MoveFileTool'
import { createCopyFileTool } from '@/ai/tools/CopyFileTool'
import { checkVaultPath, invalidNameChars, cleanFileName } from '@/helpers/pathsHelpers'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp

const create = (path: string) =>
  createCreateFileTool({ skipScope: true }).execute('call-1', { path, content: 'x' })

const move = (from: string, to: string) =>
  createMoveFileTool({ skipScope: true }).execute('call-1', { from, to })

const copy = (from: string, to: string) =>
  createCopyFileTool({ skipScope: true }).execute('call-1', { from, to })

beforeEach(() => {
  app = useVault([{ path: 'Notes/Existing.md', content: 'hello' }])
})

describe('creating a note', () => {
  it('refuses a name with a hash in it, which is the one that got through', async () => {
    await expect(create('Notes/# Weekly report.md')).rejects.toThrow(/"#"/)
  })

  it('writes nothing when it refuses', async () => {
    await create('Notes/# Weekly report.md').catch(() => {})

    expect(app.vault.getAbstractFileByPath('Notes/# Weekly report.md')).toBeNull()
  })

  it('says what to use instead rather than only what is wrong', async () => {
    await expect(create('Notes/# Weekly report.md')).rejects.toThrow(/Notes\/Weekly report\.md/)
  })

  it('refuses the others that break a link just as thoroughly', async () => {
    for (const name of ['Notes/Block^ref.md', 'Notes/Br[ack]ets.md', 'Notes/Pipe|d.md']) {
      await expect(create(name), name).rejects.toThrow(/cannot be used as a name/)
    }
  })

  it('refuses a folder with one in it, since it takes everything inside down with it', async () => {
    await expect(create('Notes/#2026/Plan.md')).rejects.toThrow(/"#2026"/)
  })

  it('lets an ordinary name through', async () => {
    await create('Notes/Weekly report.md')

    expect(app.vault.getAbstractFileByPath('Notes/Weekly report.md')).not.toBeNull()
  })

  /** Punctuation that links cope with is nobody's business to refuse. */
  it('does not get fussy about names that are merely unusual', async () => {
    for (const name of ["Notes/Anna's day.md", 'Notes/50% done.md', 'Notes/A, B & C.md']) {
      await expect(create(name), name).resolves.toBeTruthy()
    }
  })
})

describe('moving and copying', () => {
  it('refuses to move a file to a name that cannot be linked to', async () => {
    await expect(move('Notes/Existing.md', 'Notes/# Renamed.md')).rejects.toThrow(/"#"/)
    expect(app.vault.getAbstractFileByPath('Notes/Existing.md')).not.toBeNull()
  })

  it('refuses to copy one there either', async () => {
    await expect(copy('Notes/Existing.md', 'Notes/Copy^1.md')).rejects.toThrow(/"\^"/)
  })

  it('still moves where the name is fine', async () => {
    await move('Notes/Existing.md', 'Notes/Renamed.md')

    expect(app.vault.getAbstractFileByPath('Notes/Renamed.md')).not.toBeNull()
  })
})

describe('the check itself', () => {
  it('passes a path with nothing wrong with it', () => {
    expect(checkVaultPath('Notes/Weekly report.md')).toBeNull()
  })

  it('lists each offending character once, in the order they appear', () => {
    expect(invalidNameChars('a#b^c#d')).toEqual(['#', '^'])
  })

  it('names every character it found, not just the first', () => {
    const message = checkVaultPath('Notes/# Draft ^2.md') ?? ''

    expect(message).toContain('"#"')
    expect(message).toContain('"^"')
  })

  it('leaves the separators alone, being the only thing they do', () => {
    expect(checkVaultPath('A/B/C.md')).toBeNull()
  })
})

describe('the cleaner the suggestion comes from', () => {
  /** It stripped what Obsidian's dialog forbids but not what quietly breaks links. */
  it('now takes out the link-breaking characters as well', () => {
    expect(cleanFileName('# Weekly report')).toBe('Weekly report')
    expect(cleanFileName('Block^ref')).toBe('Blockref')
  })

  it('still takes out what it always did', () => {
    expect(cleanFileName('a/b:c?d')).toBe('abcd')
  })
})

describe('a note built from a template', () => {
  /** Tasks, transactions, time entries and user templates all come out of here. */
  it('is refused the same way, rather than only the agent’s tools being careful', async () => {
    const { TaskNoteTemplate } = await import('@/templates/TaskNoteTemplate')
    const template = new TaskNoteTemplate(app as never)

    await template.createNoteWithTemplate({ taskName: '# Weekly report', taskFolder: 'Tasks' }, false)

    expect(app.vault.getAbstractFileByPath('Tasks/# Weekly report.md')).toBeNull()
  })

  /** This path swallows its errors, so without a notice the refusal happens in silence. */
  it('says out loud that it could not, rather than doing nothing visible', async () => {
    const { Notice } = await import('obsidian')
    const { TaskNoteTemplate } = await import('@/templates/TaskNoteTemplate')
    Notice.shown.length = 0

    await new TaskNoteTemplate(app as never).createNoteWithTemplate(
      { taskName: '# Weekly report', taskFolder: 'Tasks' },
      false
    )

    expect(Notice.shown.join('\n')).toContain('"#"')
  })

  it('still creates one with an ordinary name', async () => {
    const { TaskNoteTemplate } = await import('@/templates/TaskNoteTemplate')
    const template = new TaskNoteTemplate(app as never)

    await template.createNoteWithTemplate({ taskName: 'Weekly report', taskFolder: 'Tasks' }, false)

    expect(app.vault.getAbstractFileByPath('Tasks/Weekly report.md')).not.toBeNull()
  })
})
