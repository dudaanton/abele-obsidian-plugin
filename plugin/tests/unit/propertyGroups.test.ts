/**
 * The values behind the groups widget: links read and written as they are stored, the same note
 * by another spelling counted once, and the groups offered for what is typed — the vault's own
 * first, most members first, then other notes by name.
 */
import { describe, it, expect } from 'vitest'
import {
  addGroup,
  collectGroups,
  groupEntries,
  groupLink,
  groupLinkpath,
  isGroupsValue,
  suggestGroups,
} from '@/properties/groups'
import { pickKind } from '@/properties/kinds'

/** Resolves a link by its last part, the way a vault with unique note names does. */
const target = (entry: string) => {
  const name = groupLinkpath(entry).split('/').pop()!
  return name ? `Notes/${name}.md` : ''
}

describe('reading a groups value', () => {
  it('takes the links as stored, and nothing from an empty or missing value', () => {
    expect(groupEntries(null)).toEqual([])
    expect(groupEntries(undefined)).toEqual([])
    expect(groupEntries('')).toEqual([])
    expect(groupEntries('[[Garden]]')).toEqual(['[[Garden]]'])
    expect(groupEntries(['[[Garden]]', null, '', '[[Work/Desk|Desk]]'])).toEqual([
      '[[Garden]]',
      '[[Work/Desk|Desk]]',
    ])
  })

  it('draws text and lists of text, and leaves anything else to Obsidian', () => {
    expect(isGroupsValue(null)).toBe(true)
    expect(isGroupsValue('[[Garden]]')).toBe(true)
    expect(isGroupsValue(['[[Garden]]', null])).toBe(true)
    expect(isGroupsValue([{ a: 1 }])).toBe(false)
    expect(isGroupsValue(3)).toBe(false)
    expect(isGroupsValue([3])).toBe(false)
  })

  it('reads where a link points, without its alias or heading', () => {
    expect(groupLinkpath('[[Work/Desk|The desk]]')).toBe('Work/Desk')
    expect(groupLinkpath('[[Garden#Beds]]')).toBe('Garden')
    expect(groupLinkpath('Garden')).toBe('Garden')
  })
})

describe('writing a groups value', () => {
  it('adds a link at the end, keeping the others as written', () => {
    expect(addGroup(null, groupLink('Garden'), target)).toEqual(['[[Garden]]'])
    expect(addGroup('[[Work/Desk|Desk]]', groupLink('Garden'), target)).toEqual([
      '[[Work/Desk|Desk]]',
      '[[Garden]]',
    ])
  })

  it('does not add a note already there under another spelling', () => {
    expect(addGroup(['[[Notes/Garden|Beds]]'], '[[Garden]]', target)).toBeNull()
  })
})

describe('the groups on offer', () => {
  const title = (path: string) => path.split('/').pop()!.replace(/\.md$/, '')
  const resolve = (entry: string) => (groupLinkpath(entry) === 'Gone' ? null : target(entry))
  const groups = collectGroups(
    [
      { value: ['[[Garden]]', '[[Work]]'], source: 'a.md' },
      { value: ['[[Work]]', '[[Notes/Work|Job]]'], source: 'b.md' },
      { value: '[[Work]]', source: 'c.md' },
      { value: ['[[Gone]]', '[[Reading]]'], source: 'd.md' },
      { value: null, source: 'e.md' },
    ],
    resolve,
    title
  )

  it('are the notes named as groups, most members first, a link to nothing left out', () => {
    expect(groups.map((g) => [g.title, g.members])).toEqual([
      ['Work', 3],
      ['Garden', 1],
      ['Reading', 1],
    ])
  })

  it('leave out those already held, and put names starting with the text first', () => {
    const held = new Set(['Notes/Garden.md'])
    expect(suggestGroups(groups, [], held, '').map((g) => g.title)).toEqual(['Work', 'Reading'])
    const notes = [
      { path: 'Notes/Rework.md', title: 'Rework' },
      { path: 'Notes/Work.md', title: 'Work' },
      { path: 'Archive/Woodwork.md', title: 'Woodwork' },
      { path: 'Notes/Worksheet.md', title: 'Worksheet' },
    ]
    expect(suggestGroups(groups, notes, held, 'wor').map((g) => g.title)).toEqual([
      'Work',
      'Worksheet',
      'Rework',
      'Woodwork',
    ])
  })

  it('find other notes by folder too, but only once something is typed', () => {
    const notes = [{ path: 'Archive/Old.md', title: 'Old' }]
    expect(suggestGroups(groups, notes, new Set(), '').map((g) => g.title)).not.toContain('Old')
    expect(suggestGroups(groups, notes, new Set(), 'archive').map((g) => g.title)).toEqual(['Old'])
  })
})

describe('which rows are groups', () => {
  const lists = { groupKeys: () => ['groups'], labelKeys: () => ['labels'] }

  it('draws a listed name held as a list or as text, whatever its case', () => {
    expect(pickKind(lists, 'groups', ['[[A]]'], 'multitext')).not.toBeNull()
    expect(pickKind(lists, 'Groups', null, 'text')).not.toBeNull()
    expect(pickKind(lists, 'groups', [{ a: 1 }], 'multitext')).toBeNull()
    expect(pickKind(lists, 'labels', ['[[A]]'], 'multitext')).not.toBe(
      pickKind(lists, 'groups', ['[[A]]'], 'multitext')
    )
  })
})
