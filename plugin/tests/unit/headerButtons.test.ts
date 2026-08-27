/**
 * Which buttons a note's header offers, and what they hand the script.
 *
 * A button is configured once for a type of note and then appears on every note of that type,
 * so the interesting part is not the button but the note underneath it: the same button has
 * to pass different values on each one. That is what the templates in its parameters are for.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { HeaderButtonDefinition } from '@/services/AbeleConfig'
import { buttonsForType, noteVariables, buttonParams } from '@/helpers/headerButtons'
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
