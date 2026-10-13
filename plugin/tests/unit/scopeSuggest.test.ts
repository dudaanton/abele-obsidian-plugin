/**
 * The one field that adds a place to what an agent can reach: notes, folders, group notes and
 * patterns in one list, as the quick switcher mixes its kinds. The open note comes first while
 * nothing is typed, a pattern first once the text has a `*` or `?`; then folders, groups with
 * their size, and files. Whatever is in reach already is not offered again, nor are chat logs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { TFile, TFolder } from 'obsidian'
import { ScopeSuggest } from '@/helpers/suggesters/ScopeSuggest'
import { ScopeResolver, type ScopeEntry } from '@/ai/ScopeResolver'
import { useVault } from '../helpers/testEnv'

function folder(path: string): TFolder {
  const f = new TFolder()
  f.path = path
  f.name = path.split('/').pop() ?? path
  return f
}
function file(path: string): TFile {
  const f = new TFile()
  f.path = path
  f.name = path.split('/').pop() ?? path
  f.extension = path.split('.').pop() ?? ''
  return f
}

const tree = [
  folder(''),
  folder('Samples'),
  folder('Samples/Inner'),
  file('Samples/alpha.md'),
  file('Samples/open-note.md'),
  file('Samples/Sample group.md'),
  file('Samples/talk.abchat'),
]
let open: TFile | null
let taken: ScopeEntry[]
let chosen: ScopeEntry[]

function field() {
  const input = document.createElement('input')
  document.body.append(input)
  const app = {
    vault: { getAllLoadedFiles: () => tree },
    workspace: { getActiveFile: () => open },
  } as unknown as App
  return {
    input,
    suggest: new ScopeSuggest(
      app,
      input,
      () => taken,
      (e) => chosen.push(e)
    ),
  }
}
const listed = (choices: { entry: ScopeEntry; kind: string }[]) =>
  choices.map((c) => [c.entry.type, c.entry.path, c.kind])

beforeEach(() => {
  open = tree[4] as TFile
  taken = []
  chosen = []
  vi.spyOn(ScopeResolver.getInstance(), 'groupSizes').mockReturnValue(
    new Map([
      ['Samples/Sample group.md', 3],
      ['Samples/Single group.md', 1],
    ])
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('what the access field offers', () => {
  it('puts the open note first, then folders, groups by size and files, with no chat logs', () => {
    expect(listed(field().suggest.getSuggestions(''))).toEqual([
      ['file', 'Samples/open-note.md', 'open note'],
      ['folder', 'Samples', 'folder'],
      ['folder', 'Samples/Inner', 'folder'],
      ['group', 'Samples/Sample group.md', 'group · 3 notes'],
      ['group', 'Samples/Single group.md', 'group · 1 note'],
      ['file', 'Samples/alpha.md', ''],
      ['file', 'Samples/Sample group.md', ''],
    ])
  })

  it('narrows to what the text matches, anywhere in the path, and without the open note', () => {
    expect(listed(field().suggest.getSuggestions('inner'))).toEqual([
      ['folder', 'Samples/Inner', 'folder'],
    ])
    expect(listed(field().suggest.getSuggestions('ALPHA'))).toEqual([
      ['file', 'Samples/alpha.md', ''],
    ])
  })

  it('offers a glob as a pattern first, as typed', () => {
    const choices = field().suggest.getSuggestions(' Samples/**/*.md ')
    expect(listed(choices)[0]).toEqual(['pattern', 'Samples/**/*.md', 'pattern'])
    expect(listed(field().suggest.getSuggestions('alpha?'))[0]).toEqual([
      'pattern',
      'alpha?',
      'pattern',
    ])
  })

  it('leaves out what is in reach already', () => {
    taken = [
      { type: 'file', path: 'Samples/open-note.md' },
      { type: 'folder', path: 'Samples' },
      { type: 'group', path: 'Samples/Sample group.md' },
    ]
    expect(listed(field().suggest.getSuggestions(''))).toEqual([
      ['folder', 'Samples/Inner', 'folder'],
      ['group', 'Samples/Single group.md', 'group · 1 note'],
      ['file', 'Samples/alpha.md', ''],
      ['file', 'Samples/Sample group.md', ''],
    ])
  })

  it('hands a chosen place on and empties the field for the next', () => {
    const { input, suggest } = field()
    input.value = 'alp'
    suggest.selectSuggestion({ entry: { type: 'file', path: 'Samples/alpha.md' }, kind: '' })
    expect(chosen).toEqual([{ type: 'file', path: 'Samples/alpha.md' }])
    expect(input.value).toBe('')
  })
})

describe('group sizes', () => {
  it('counts the notes that name each group note in their groups', () => {
    vi.restoreAllMocks()
    useVault([
      { path: 'Samples/Sample group.md' },
      { path: 'Samples/Other group.md' },
      { path: 'Samples/one.md', frontmatter: { groups: ['[[Sample group]]'] } },
      {
        path: 'Samples/two.md',
        frontmatter: { groups: ['[[Sample group]]', '[[Other group]]'] },
      },
      { path: 'Samples/loose.md' },
    ])
    expect(ScopeResolver.getInstance().groupSizes()).toEqual(
      new Map([
        ['Samples/Sample group.md', 2],
        ['Samples/Other group.md', 1],
      ])
    )
  })
})
