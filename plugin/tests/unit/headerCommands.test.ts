/**
 * Header buttons that run any Obsidian command, rather than a script: which notes show them, what
 * happens to one whose command is gone, and how many fit in a phone's header.
 *
 * The drawing into the header itself is `tests/e2e/headerCommands.e2e.test.ts`; the settings form
 * is `tests/component/headerButtonsEditor.test.ts`.
 */
import { describe, it, expect } from 'vitest'
import { normalizeHeaderButton, type HeaderButtonDefinition } from '@/services/AbeleConfig'
import {
  buttonsForNote,
  commandButtonsFor,
  scriptButtonsFor,
  placementProblems,
  splitForHeader,
  pathFitsFolder,
} from '@/helpers/headerButtons'

function command(overrides: Partial<HeaderButtonDefinition> = {}): HeaderButtonDefinition {
  return normalizeHeaderButton({
    id: 'c1',
    name: 'Bold',
    icon: 'bold',
    runs: 'command',
    commandId: 'editor:toggle-bold',
    allNotes: true,
    ...overrides,
  })
}

function script(overrides: Partial<HeaderButtonDefinition> = {}): HeaderButtonDefinition {
  return normalizeHeaderButton({
    id: 's1',
    name: 'Fetch',
    scriptName: 'Fetch',
    allNotes: true,
    ...overrides,
  })
}

const note = (path: string, extra: Record<string, unknown> = {}) => ({
  type: null,
  path,
  frontmatter: null,
  ...extra,
})

describe('a button that runs a command', () => {
  it('is kept whole on the way in: its command, tags and whether it shows beyond notes', () => {
    const made = normalizeHeaderButton({
      runs: 'command',
      commandId: 'app:go-back',
      tags: ['work'],
      otherFiles: true,
    })

    expect(made).toMatchObject({
      runs: 'command',
      commandId: 'app:go-back',
      tags: ['work'],
      otherFiles: true,
    })
    // An old button, saved before buttons could run commands, still runs its script.
    expect(normalizeHeaderButton({ scriptName: 'Fetch' })).toMatchObject({
      runs: 'script',
      commandId: '',
      tags: [],
      otherFiles: false,
    })
  })

  it('shows on every note when it is set to', () => {
    expect(commandButtonsFor([command()], note('Anywhere/A.md'))).toHaveLength(1)
  })

  it('is hidden when it names no command, which would do nothing if pressed', () => {
    expect(commandButtonsFor([command({ commandId: '' })], note('A.md'))).toEqual([])
  })

  it('is hidden while its command is gone — the plugin that gives it switched off', () => {
    const buttons = [command(), command({ id: 'c2', commandId: 'dataview:refresh' })]
    const has = (id: string) => id === 'editor:toggle-bold'

    expect(commandButtonsFor(buttons, note('A.md'), { hasCommand: has }).map((b) => b.id)).toEqual([
      'c1',
    ])
  })

  it('never shows among the script buttons of the note body, nor a script one among these', () => {
    const buttons = [command(), script()]

    expect(scriptButtonsFor(buttons, note('A.md')).map((b) => b.id)).toEqual(['s1'])
    expect(commandButtonsFor(buttons, note('A.md')).map((b) => b.id)).toEqual(['c1'])
    expect(buttonsForNote(buttons, note('A.md')).map((b) => b.id)).toEqual(['c1', 's1'])
  })

  it('shows only on notes inside its folder', () => {
    const inFolder = command({ allNotes: false, folders: ['Projects'] })

    expect(commandButtonsFor([inFolder], note('Projects/Site/Plan.md'))).toHaveLength(1)
    expect(commandButtonsFor([inFolder], note('Inbox/Plan.md'))).toEqual([])
  })

  it('takes the conditions a script button takes: type and properties', () => {
    const typed = command({
      allNotes: false,
      noteTypes: ['task'],
      conditions: [{ property: 'status', test: 'equals', value: 'open' }],
    })

    expect(
      commandButtonsFor([typed], note('T.md', { type: 'task', frontmatter: { status: 'open' } }))
    ).toHaveLength(1)
    expect(
      commandButtonsFor([typed], note('T.md', { type: 'task', frontmatter: { status: 'done' } }))
    ).toEqual([])
  })

  it('is kept off everything but notes unless it asks for other files too', () => {
    const pdf = note('Papers/A.pdf', { markdown: false })

    expect(commandButtonsFor([command()], pdf)).toEqual([])
    expect(commandButtonsFor([command({ otherFiles: true })], pdf)).toHaveLength(1)
    // A script button stays in the note's own header, which a PDF does not have.
    expect(scriptButtonsFor([script()], pdf)).toEqual([])
  })
})

describe('placing a button by tag', () => {
  it('shows on a note with the tag, a nested one under it included, with or without the #', () => {
    const tagged = command({ allNotes: false, tags: ['#work'] })

    expect(commandButtonsFor([tagged], note('A.md', { tags: ['#work'] }))).toHaveLength(1)
    expect(commandButtonsFor([tagged], note('A.md', { tags: ['#Work/Meetings'] }))).toHaveLength(1)
    expect(commandButtonsFor([tagged], note('A.md', { tags: ['#workshop'] }))).toEqual([])
    expect(commandButtonsFor([tagged], note('A.md'))).toEqual([])
  })

  it('shows on a note that fits any of its places: a tag or a folder', () => {
    const either = command({ allNotes: false, tags: ['work'], folders: ['Projects'] })

    expect(commandButtonsFor([either], note('Projects/A.md'))).toHaveLength(1)
    expect(commandButtonsFor([either], note('Inbox/A.md', { tags: ['#work'] }))).toHaveLength(1)
  })

  it('applies to script buttons the same way', () => {
    const tagged = script({ allNotes: false, tags: ['film'] })

    expect(scriptButtonsFor([tagged], note('A.md', { tags: ['#film'] }))).toHaveLength(1)
  })
})

describe('a folder written as a pattern', () => {
  it('matches one level with * and any depth with **', () => {
    expect(pathFitsFolder('Projects/Site/Notes/A.md', 'Projects/*/Notes')).toBe(true)
    expect(pathFitsFolder('Projects/Site/Deep/Notes/A.md', 'Projects/*/Notes')).toBe(false)
    expect(pathFitsFolder('Projects/Site/Deep/Notes/A.md', 'Projects/**/Notes')).toBe(true)
    expect(pathFitsFolder('Journal/2026-09-27.md', 'Journal')).toBe(true)
    expect(pathFitsFolder('Journalism/A.md', 'Journal')).toBe(false)
  })
})

describe('what does not fit in the header', () => {
  it('goes to the more-options menu, in the same order', () => {
    const buttons = ['a', 'b', 'c', 'd'].map((id) => command({ id }))

    const split = splitForHeader(buttons, 2)
    expect(split.shown.map((b) => b.id)).toEqual(['a', 'b'])
    expect(split.overflow.map((b) => b.id)).toEqual(['c', 'd'])
    expect(splitForHeader(buttons, Infinity).overflow).toEqual([])
  })
})

describe('saying in settings why a command button would show nowhere', () => {
  const vault = { types: new Set<string>(), folderExists: () => true }

  it('asks for a command first', () => {
    expect(placementProblems(command({ commandId: '' }), vault).nowhere).toBe(
      'Shows nowhere until a command is chosen.'
    )
  })

  it('says when the command is not there now', () => {
    const gone = { ...vault, hasCommand: () => false }

    expect(placementProblems(command(), gone).nowhere).toMatch(/not available/)
  })

  it('counts tags as a place', () => {
    expect(placementProblems(command({ allNotes: false, tags: ['work'] }), vault).nowhere).toBe(
      null
    )
  })

  it('does not call a folder pattern missing', () => {
    const shape = { types: new Set<string>(), folderExists: (f: string) => f === 'Projects' }

    expect(
      placementProblems(command({ allNotes: false, folders: ['Projects/*/Notes'] }), shape)
        .missingFolders
    ).toEqual([])
  })
})
