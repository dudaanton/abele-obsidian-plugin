/**
 * Which sections of which note's footer are folded: a plain record, kept per vault.
 *
 * The record is the whole of the state, so everything that could go wrong with it — a fold
 * lost on a rename, a record growing for ever with every note ever folded, a stored value
 * that is not what we wrote — is decided here, away from Vue and the app.
 */
import { describe, it, expect } from 'vitest'
import { FOLD_LIMIT, foldStateFrom, isFolded, renameFolds, setFolded } from '@/helpers/footerFolds'

describe('footer folds', () => {
  it('starts with every section open', () => {
    expect(isFolded({}, 'Notes/A.md', 'transactions')).toBe(false)
  })

  it('folds one section of one note, and nothing else', () => {
    const state = setFolded({}, 'Notes/A.md', 'transactions', true)

    expect(isFolded(state, 'Notes/A.md', 'transactions')).toBe(true)
    expect(isFolded(state, 'Notes/A.md', 'logs')).toBe(false)
    expect(isFolded(state, 'Notes/B.md', 'transactions')).toBe(false)
  })

  it('opens it again and keeps no empty entry behind', () => {
    const folded = setFolded({}, 'Notes/A.md', 'logs', true)
    const opened = setFolded(folded, 'Notes/A.md', 'logs', false)

    expect(isFolded(opened, 'Notes/A.md', 'logs')).toBe(false)
    expect(opened).toEqual({})
  })

  it('does not change the record it was given', () => {
    const before = setFolded({}, 'Notes/A.md', 'logs', true)
    const copy = JSON.parse(JSON.stringify(before))
    setFolded(before, 'Notes/A.md', 'tasks', true)
    setFolded(before, 'Notes/A.md', 'logs', false)

    expect(before).toEqual(copy)
  })

  it('forgets the notes folded longest ago once it holds too many', () => {
    let state = {}
    for (let i = 0; i <= FOLD_LIMIT; i++) state = setFolded(state, `N/${i}.md`, 'logs', true)

    expect(Object.keys(state)).toHaveLength(FOLD_LIMIT)
    expect(isFolded(state, 'N/0.md', 'logs')).toBe(false)
    expect(isFolded(state, `N/${FOLD_LIMIT}.md`, 'logs')).toBe(true)
  })

  it('counts a note touched again as recent', () => {
    let state = setFolded({}, 'N/old.md', 'logs', true)
    for (let i = 0; i < FOLD_LIMIT - 1; i++) state = setFolded(state, `N/${i}.md`, 'logs', true)
    state = setFolded(state, 'N/old.md', 'tasks', true)
    state = setFolded(state, 'N/new.md', 'logs', true)

    expect(isFolded(state, 'N/old.md', 'logs')).toBe(true)
    expect(isFolded(state, 'N/0.md', 'logs')).toBe(false)
  })

  it('follows a note that is renamed or moved', () => {
    const state = setFolded({}, 'Notes/A.md', 'transactions', true)
    const moved = renameFolds(state, 'Notes/A.md', 'Archive/A2.md')

    expect(isFolded(moved, 'Archive/A2.md', 'transactions')).toBe(true)
    expect(isFolded(moved, 'Notes/A.md', 'transactions')).toBe(false)
    expect(renameFolds(state, 'Other.md', 'X.md')).toBe(state)
  })

  it('reads back only what it could have written', () => {
    expect(foldStateFrom(null)).toEqual({})
    expect(foldStateFrom('junk')).toEqual({})
    expect(foldStateFrom([1, 2])).toEqual({})
    expect(foldStateFrom({ 'A.md': ['logs', 'nonsense', 3], 'B.md': 'logs', 'C.md': [] })).toEqual({
      'A.md': ['logs'],
    })
  })
})
