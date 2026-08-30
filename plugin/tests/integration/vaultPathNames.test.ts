/**
 * Names that cannot be linked to are cleaned on the way in.
 *
 * A script derived a note's name from a markdown heading and left the `#` on the front.
 * `vault.create` took it without a word — Obsidian only refuses such names in its own new-file
 * dialog — and out came a note that no wikilink can reach, because `[[Note#x]]` addresses a
 * heading rather than a file. Refusing it cost the caller its work over some punctuation, so
 * the character goes and the note is made; what matters then is that the reply says what the
 * note is really called, since nobody will find it under the name they asked for.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createCreateFileTool } from '@/ai/tools/CreateFileTool'
import { createMoveFileTool } from '@/ai/tools/MoveFileTool'
import { createCopyFileTool } from '@/ai/tools/CopyFileTool'
import { toSafeVaultPath, invalidNameChars, cleanFileName } from '@/helpers/pathsHelpers'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

let app: FakeApp

const said = (result: { content: { type: string; text?: string }[] }) =>
  result.content.map((part) => part.text ?? '').join('\n')

const create = async (path: string) =>
  said(await createCreateFileTool({ skipScope: true }).execute('call-1', { path, content: 'x' }))

const move = async (from: string, to: string) =>
  said(await createMoveFileTool({ skipScope: true }).execute('call-1', { from, to }))

const copy = async (from: string, to: string) =>
  said(await createCopyFileTool({ skipScope: true }).execute('call-1', { from, to }))

const exists = (path: string) => app.vault.getAbstractFileByPath(path) !== null

beforeEach(() => {
  app = useVault([{ path: 'Notes/Existing.md', content: 'hello' }])
})

describe('creating a note', () => {
  it('drops the hash and makes the note, which is the one that got through', async () => {
    await create('Notes/# Weekly report.md')

    expect(exists('Notes/Weekly report.md')).toBe(true)
    expect(exists('Notes/# Weekly report.md')).toBe(false)
  })

  /** Whoever asked will look for the name they gave, so the reply has to correct them. */
  it('answers with the name it really used, and why it differs', async () => {
    const answer = await create('Notes/# Weekly report.md')

    expect(answer).toContain('Notes/Weekly report.md')
    expect(answer).toContain('"#"')
  })

  it('says nothing extra when the name was fine', async () => {
    expect(await create('Notes/Weekly report.md')).toBe('Created: Notes/Weekly report.md')
  })

  it('cleans the others that break a link just as thoroughly', async () => {
    await create('Notes/Block^ref.md')
    await create('Notes/Br[ack]ets.md')
    await create('Notes/Pipe|d.md')

    expect(exists('Notes/Blockref.md')).toBe(true)
    expect(exists('Notes/Brackets.md')).toBe(true)
    expect(exists('Notes/Piped.md')).toBe(true)
  })

  it('cleans a folder too, since it takes the links of everything inside it down', async () => {
    await create('Notes/#2026/Plan.md')

    expect(exists('Notes/2026/Plan.md')).toBe(true)
  })

  /** Punctuation that links cope with is nobody's business to rewrite. */
  it('leaves alone a name that is merely unusual', async () => {
    for (const name of ["Notes/Anna's day.md", 'Notes/50% done.md', 'Notes/A, B & C.md']) {
      expect(await create(name), name).toBe(`Created: ${name}`)
    }
  })

  /** A cleaned name landing on an existing note is still a collision worth stopping at. */
  it('still refuses when the cleaned name is taken', async () => {
    await expect(create('Notes/#Existing.md')).rejects.toThrow(/already exists: Notes\/Existing/)
  })
})

describe('moving and copying', () => {
  it('moves to the cleaned name and says so', async () => {
    const answer = await move('Notes/Existing.md', 'Notes/# Renamed.md')

    expect(exists('Notes/Renamed.md')).toBe(true)
    expect(answer).toContain('Notes/Renamed.md')
    expect(answer).toContain('"#"')
  })

  it('copies to the cleaned name too', async () => {
    await copy('Notes/Existing.md', 'Notes/Copy^1.md')

    expect(exists('Notes/Copy1.md')).toBe(true)
    expect(exists('Notes/Existing.md')).toBe(true)
  })

  it('still moves where the name is fine', async () => {
    expect(await move('Notes/Existing.md', 'Notes/Renamed.md')).toBe(
      'Moved: Notes/Existing.md → Notes/Renamed.md'
    )
  })
})

describe('the cleaning itself', () => {
  it('leaves a good path exactly as it is', () => {
    expect(toSafeVaultPath('Notes/Weekly report.md')).toBe('Notes/Weekly report.md')
  })

  it('takes out every forbidden character, wherever it sits', () => {
    expect(toSafeVaultPath('Notes/# Draft ^2 [v3].md')).toBe('Notes/Draft 2 v3.md')
  })

  it('leaves the separators alone, being the only thing they do', () => {
    expect(toSafeVaultPath('A/B/C.md')).toBe('A/B/C.md')
  })

  /** Otherwise the segment vanishes and the file quietly moves up a folder. */
  it('gives a name to a segment that was nothing but forbidden characters', () => {
    expect(toSafeVaultPath('Notes/###/Plan.md')).toBe('Notes/Untitled/Plan.md')
  })

  it('lists each offending character once, in the order they appear', () => {
    expect(invalidNameChars('a#b^c#d')).toEqual(['#', '^'])
  })
})

describe('the older cleaner, used where a name is built from prose', () => {
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
  const taskTemplate = async () => {
    const { TaskNoteTemplate } = await import('@/templates/TaskNoteTemplate')
    return new TaskNoteTemplate(app as never)
  }

  /** Tasks, transactions, time entries and user templates all come out of here. */
  it('is cleaned the same way, rather than only the agent’s tools being careful', async () => {
    const template = await taskTemplate()

    await template.createNoteWithTemplate(
      { taskName: '# Weekly report', taskFolder: 'Tasks' },
      false
    )

    expect(exists('Tasks/Weekly report.md')).toBe(true)
  })

  it('still creates one with an ordinary name', async () => {
    const template = await taskTemplate()

    await template.createNoteWithTemplate({ taskName: 'Weekly report', taskFolder: 'Tasks' }, false)

    expect(exists('Tasks/Weekly report.md')).toBe(true)
  })
})

describe('what a script is told', () => {
  const context = async () => {
    const { buildScriptContext } = await import('@/scripting/ScriptContext')
    const { AbeleConfig } = await import('@/services/AbeleConfig')
    const { DEFAULT_AI_SETTINGS } = await import('@/ai/types')
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
    return buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })
  }

  /** A script that linked to the name it passed would be linking to nothing. */
  it('gets back the path the note was really created at', async () => {
    const ctx = await context()

    const path = await ctx.create('Notes/# Weekly report.md', 'body')

    expect(path).toBe('Notes/Weekly report.md')
  })

  it('gets back the same path when nothing had to change', async () => {
    const ctx = await context()

    expect(await ctx.create('Notes/Plain.md', 'body')).toBe('Notes/Plain.md')
  })

  it('gets back where a move and a copy ended up', async () => {
    const ctx = await context()

    expect(await ctx.copy('Notes/Existing.md', 'Notes/Copy^1.md')).toBe('Notes/Copy1.md')
    expect(await ctx.move('Notes/Existing.md', 'Notes/# Moved.md')).toBe('Notes/Moved.md')
  })
})
