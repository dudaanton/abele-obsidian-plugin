/**
 * Which buttons a note's header offers, and what they hand the script.
 *
 * A button is configured once for a type of note and then appears on every note of that type,
 * so the interesting part is not the button but the note underneath it: the same button has
 * to pass different values on each one. That is what the templates in its parameters are for.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { HeaderButtonDefinition } from '@/services/AbeleConfig'
import {
  buttonsForType,
  buttonsForNote,
  noteVariables,
  buttonParams,
  placementProblems,
} from '@/helpers/headerButtons'
import { useVault } from '../helpers/testEnv'

function button(overrides: Partial<HeaderButtonDefinition> = {}): HeaderButtonDefinition {
  return {
    id: 'b1',
    name: 'Fetch details',
    icon: 'play',
    noteTypes: ['movie'],
    scriptName: 'Fetch',
    params: {},
    ...overrides,
  }
}

describe('choosing the buttons for a note', () => {
  it('offers the ones configured for its type', () => {
    const movie = button()
    const book = button({ id: 'b2', noteTypes: ['book'] })

    expect(buttonsForType([movie, book], 'movie')).toEqual([movie])
  })

  it('does not care about case or stray spaces, in the note or in the setting', () => {
    const configured = button({ noteTypes: [' Movie '] })

    expect(buttonsForType([configured], 'MOVIE ')).toEqual([configured])
  })

  it('offers a button listed under several types on each of them', () => {
    const configured = button({ noteTypes: ['movie', 'book'] })

    expect(buttonsForType([configured], 'book')).toEqual([configured])
  })

  it('offers nothing to a note without a type', () => {
    expect(buttonsForType([button()], null)).toEqual([])
    expect(buttonsForType([button()], '')).toEqual([])
  })

  it('hides a button that names no script, which would do nothing if pressed', () => {
    expect(buttonsForType([button({ scriptName: '' })], 'movie')).toEqual([])
  })
})

describe('choosing the buttons for a note by where it is, too', () => {
  it('offers a button set for a folder on the notes inside it, at any depth', () => {
    const configured = button({ noteTypes: [], folders: ['Films'] })

    expect(
      buttonsForNote([configured], { type: null, path: 'Films/Noir/The Third Man.md' })
    ).toEqual([configured])
    expect(buttonsForNote([configured], { type: null, path: 'Filmsy/Other.md' })).toEqual([])
  })

  it('does not care about a trailing slash on the folder', () => {
    const configured = button({ noteTypes: [], folders: ['Films/'] })

    expect(buttonsForNote([configured], { type: null, path: 'Films/A.md' })).toEqual([configured])
  })

  it('offers a button on either its types or its folders', () => {
    const configured = button({ noteTypes: ['book'], folders: ['Films'] })

    expect(buttonsForNote([configured], { type: 'book', path: 'Books/A.md' })).toEqual([configured])
    expect(buttonsForNote([configured], { type: 'movie', path: 'Films/A.md' })).toEqual([
      configured,
    ])
    expect(buttonsForNote([configured], { type: 'movie', path: 'Else/A.md' })).toEqual([])
  })

  it('offers a button set for every note on every note, typed or not', () => {
    const configured = button({ noteTypes: [], allNotes: true })

    expect(buttonsForNote([configured], { type: null, path: 'A.md' })).toEqual([configured])
  })

  it('hides a button that is switched off, wherever it would have shown', () => {
    const configured = button({ enabled: false, allNotes: true })

    expect(buttonsForNote([configured], { type: 'movie', path: 'A.md' })).toEqual([])
  })

  it('keeps the order they were configured in', () => {
    const first = button({ id: 'b1', name: 'Second added, placed first' })
    const second = button({ id: 'b2', name: 'Placed second' })

    expect(buttonsForNote([first, second], { type: 'movie', path: 'A.md' })).toEqual([
      first,
      second,
    ])
  })
})

describe('choosing the buttons for a note by its properties', () => {
  const film = (frontmatter: Record<string, unknown>) => ({
    type: 'movie',
    path: 'Films/A.md',
    frontmatter,
  })

  it('offers a button only where its property holds the value, whatever the case', () => {
    const configured = button({
      conditions: [{ property: 'status', test: 'equals', value: 'Watched' }],
    })

    expect(buttonsForNote([configured], film({ status: 'watched' }))).toEqual([configured])
    expect(buttonsForNote([configured], film({ status: 'queued' }))).toEqual([])
    expect(buttonsForNote([configured], film({}))).toEqual([])
  })

  it('reads a list property as holding the value when any of its items does', () => {
    const configured = button({
      conditions: [{ property: 'labels', test: 'equals', value: 'inwork' }],
    })

    expect(buttonsForNote([configured], film({ labels: ['home', 'inwork'] }))).toEqual([configured])
  })

  it('matches a link by the note it names, brackets or not', () => {
    const configured = button({
      conditions: [{ property: 'project', test: 'equals', value: 'Garden' }],
    })

    expect(buttonsForNote([configured], film({ project: '[[Garden]]' }))).toEqual([configured])
  })

  it('matches a number or a checkbox by what it reads as', () => {
    const configured = button({
      conditions: [
        { property: 'rating', test: 'equals', value: '5' },
        { property: 'done', test: 'equals', value: 'false' },
      ],
    })

    expect(buttonsForNote([configured], film({ rating: 5, done: false }))).toEqual([configured])
  })

  it('offers a button whose property is anything but the value, missing included', () => {
    const configured = button({
      conditions: [{ property: 'status', test: 'not-equals', value: 'done' }],
    })

    expect(buttonsForNote([configured], film({ status: 'todo' }))).toEqual([configured])
    expect(buttonsForNote([configured], film({}))).toEqual([configured])
    expect(buttonsForNote([configured], film({ status: 'Done' }))).toEqual([])
  })

  it('tells a filled property from an empty one, an empty list or string being empty', () => {
    const filled = button({ id: 'f', conditions: [{ property: 'due', test: 'filled', value: '' }] })
    const empty = button({ id: 'e', conditions: [{ property: 'due', test: 'empty', value: '' }] })

    expect(buttonsForNote([filled, empty], film({ due: '2026-09-25' }))).toEqual([filled])
    expect(buttonsForNote([filled, empty], film({ due: '' }))).toEqual([empty])
    expect(buttonsForNote([filled, empty], film({ due: [] }))).toEqual([empty])
    expect(buttonsForNote([filled, empty], film({ due: null }))).toEqual([empty])
    expect(buttonsForNote([filled, empty], film({}))).toEqual([empty])
  })

  it('needs every condition to hold, unless told any one will do', () => {
    const conditions = [
      { property: 'status', test: 'equals' as const, value: 'watched' },
      { property: 'rating', test: 'filled' as const, value: '' },
    ]
    const all = button({ id: 'all', conditions })
    const any = button({ id: 'any', conditions, conditionMode: 'any' })

    expect(buttonsForNote([all, any], film({ status: 'watched', rating: 4 }))).toEqual([all, any])
    expect(buttonsForNote([all, any], film({ status: 'watched' }))).toEqual([any])
    expect(buttonsForNote([all, any], film({}))).toEqual([])
  })

  it('still needs the note to be of its type or in its folder', () => {
    const configured = button({
      conditions: [{ property: 'status', test: 'equals', value: 'watched' }],
    })

    expect(
      buttonsForNote([configured], {
        type: 'book',
        path: 'Books/A.md',
        frontmatter: { status: 'watched' },
      })
    ).toEqual([])
  })

  it('shows on any note its properties fit when it names no type and no folder', () => {
    const configured = button({
      noteTypes: [],
      folders: [],
      conditions: [{ property: 'status', test: 'equals', value: 'watched' }],
    })

    expect(
      buttonsForNote([configured], { type: null, path: 'A.md', frontmatter: { status: 'watched' } })
    ).toEqual([configured])
    expect(buttonsForNote([configured], { type: null, path: 'A.md', frontmatter: {} })).toEqual([])
  })

  it('ignores a condition with no property named, as one still being written', () => {
    const configured = button({ conditions: [{ property: ' ', test: 'equals', value: 'x' }] })

    expect(buttonsForNote([configured], film({}))).toEqual([configured])
  })
})

describe('what a note offers its buttons', () => {
  beforeEach(() => {
    useVault([
      {
        path: 'Films/The Third Man.md',
        frontmatter: { type: 'movie', status: 'watched', year: 1949, tags: ['noir', 'classic'] },
        content: 'Body.',
      },
    ])
  })

  it('names the note, without the extension it is stored under', () => {
    expect(noteVariables('Films/The Third Man.md').title).toBe('The Third Man')
  })

  it('gives the path and the folder holding it', () => {
    const variables = noteVariables('Films/The Third Man.md')

    expect(variables.path).toBe('Films/The Third Man.md')
    expect(variables.folder).toBe('Films')
  })

  it('leaves the folder empty for a note at the top of the vault', () => {
    expect(noteVariables('Inbox.md').folder).toBe('')
  })

  it('offers every frontmatter field', () => {
    const variables = noteVariables('Films/The Third Man.md')

    expect(variables.status).toBe('watched')
    expect(variables.type).toBe('movie')
  })

  it('writes a number and a list as a script would want to read them', () => {
    const variables = noteVariables('Films/The Third Man.md')

    expect(variables.year).toBe('1949')
    expect(variables.tags).toBe('noir, classic')
  })

  it('still describes a note that has no frontmatter at all', () => {
    const variables = noteVariables('Nothing/Plain.md')

    expect(variables.title).toBe('Plain')
    expect(variables.type).toBe('')
  })
})

describe('filling in a button’s parameters', () => {
  const variables = { title: 'The Third Man', path: 'Films/The Third Man.md', status: 'watched' }

  it('substitutes the note into them', () => {
    const configured = button({ params: { query: '{{title}}', target: '{{path}}' } })

    expect(buttonParams(configured, variables)).toEqual({
      query: 'The Third Man',
      target: 'Films/The Third Man.md',
    })
  })

  it('substitutes a frontmatter field the same way as a name of its own', () => {
    const configured = button({ params: { note: 'Status: {{status}}' } })

    expect(buttonParams(configured, variables)).toEqual({ note: 'Status: watched' })
  })

  it('leaves a fixed value alone', () => {
    const configured = button({ params: { mode: 'full' } })

    expect(buttonParams(configured, variables)).toEqual({ mode: 'full' })
  })

  it('empties a variable the note says nothing about, rather than passing it on as text', () => {
    const configured = button({ params: { director: '{{director}}' } })

    expect(buttonParams(configured, variables)).toEqual({ director: '' })
  })

  it('passes nothing when nothing is configured', () => {
    expect(buttonParams(button(), variables)).toEqual({})
  })
})

// A button that shows nowhere used to say nothing about it: set up for a type no note has, a
// folder that is not there, or no place at all, it simply never appeared. The settings say why.
describe('why a button would show nowhere', () => {
  const vault = { types: new Set(['task', 'movie']), folderExists: (f: string) => f === 'Films' }

  it('has nothing to say about a button that shows somewhere real', () => {
    expect(placementProblems(button({ noteTypes: ['Task'] }), vault)).toEqual({
      nowhere: null,
      unknownTypes: [],
      missingFolders: [],
    })
  })

  it('names a type no note in the vault has, the way it was typed', () => {
    expect(placementProblems(button({ noteTypes: ['task', 'tasks'] }), vault).unknownTypes).toEqual(
      ['tasks']
    )
  })

  it('names a folder that is not in the vault', () => {
    const configured = button({ noteTypes: [], folders: ['Films/', 'Filmz'] })

    expect(placementProblems(configured, vault).missingFolders).toEqual(['Filmz'])
  })

  it('says a button with no script shows nowhere', () => {
    expect(placementProblems(button({ scriptName: '' }), vault).nowhere).toMatch(/script/i)
  })

  it('says a button with no type, no folder and no condition shows nowhere', () => {
    expect(placementProblems(button({ noteTypes: [], folders: [] }), vault).nowhere).toMatch(
      /type|folder/i
    )
  })

  it('says a button whose every type and folder is unknown shows nowhere', () => {
    const configured = button({ noteTypes: ['tasks'], folders: ['Filmz'] })

    expect(placementProblems(configured, vault).nowhere).not.toBeNull()
  })

  it('takes every note or a property condition as somewhere', () => {
    expect(placementProblems(button({ noteTypes: [], allNotes: true }), vault).nowhere).toBeNull()
    const byProperty = button({
      noteTypes: [],
      conditions: [{ property: 'status', test: 'filled', value: '' }],
    })
    expect(placementProblems(byProperty, vault).nowhere).toBeNull()
  })
})
