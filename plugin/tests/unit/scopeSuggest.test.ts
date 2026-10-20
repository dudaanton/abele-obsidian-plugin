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

it('does not build a cold group index on the input event', async () => {
  vi.restoreAllMocks()
  const app = useVault(Array.from({ length: 20000 }, (_, i) => ({ path: `Sample ${i}.md` })))
  const input = document.createElement('input')
  const suggest = new ScopeSuggest(
    { ...app, workspace: { ...app.workspace, getActiveFile: () => null } } as unknown as App,
    input,
    () => [],
    () => {}
  )
  app.resetStats()
  const result = suggest.getSuggestions('Sample')
  const reads = app.stats.getFileCache
  await result
  suggest.close()
  expect(reads).toBe(0)
})

beforeEach(() => {
  open = tree[4] as TFile
  taken = []
  chosen = []
  vi.spyOn(ScopeResolver.getInstance(), 'groupSizesAsync').mockResolvedValue(
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
  it('keeps note and folder suggestions when group lookup fails', async () => {
    vi.mocked(ScopeResolver.getInstance().groupSizesAsync).mockRejectedValue(
      new Error('Group lookup unavailable')
    )
    expect(
      (await field().suggest.getSuggestions('alpha')).some(
        (choice) => choice.entry.path === 'Samples/alpha.md'
      )
    ).toBe(true)
  })
  it('puts the open note first, then folders, groups by size and files, with no chat logs', async () => {
    expect(listed(await field().suggest.getSuggestions(''))).toEqual([
      ['file', 'Samples/open-note.md', 'open note'],
      ['folder', 'Samples', 'folder'],
      ['folder', 'Samples/Inner', 'folder'],
      ['group', 'Samples/Sample group.md', 'group · 3 notes'],
      ['group', 'Samples/Single group.md', 'group · 1 note'],
      ['file', 'Samples/alpha.md', ''],
      ['file', 'Samples/Sample group.md', ''],
    ])
  })

  it('narrows to what the text matches, anywhere in the path, and without the open note', async () => {
    expect(listed(await field().suggest.getSuggestions('inner'))).toEqual([
      ['folder', 'Samples/Inner', 'folder'],
    ])
    expect(listed(await field().suggest.getSuggestions('ALPHA'))).toEqual([
      ['file', 'Samples/alpha.md', ''],
    ])
  })

  it('offers a glob as a pattern first, as typed', async () => {
    const choices = await field().suggest.getSuggestions(' Samples/**/*.md ')
    expect(listed(choices)[0]).toEqual(['pattern', 'Samples/**/*.md', 'pattern'])
    expect(listed(await field().suggest.getSuggestions('alpha?'))[0]).toEqual([
      'pattern',
      'alpha?',
      'pattern',
    ])
  })

  it('leaves out what is in reach already', async () => {
    taken = [
      { type: 'file', path: 'Samples/open-note.md' },
      { type: 'folder', path: 'Samples' },
      { type: 'group', path: 'Samples/Sample group.md' },
    ]
    expect(listed(await field().suggest.getSuggestions(''))).toEqual([
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

/**
 * The field is typed into, a letter at a time, on a vault of thousands of notes. Every group
 * note's size comes from one pass over the whole vault's metadata — a link resolved for each
 * `groups` value of every note — so that pass is the cost to count: once while the field stays
 * open and nothing in the vault changes, and none at all while folders already fill the list.
 */
describe('on a large vault', () => {
  const big = () => {
    const specs = [{ path: 'Hub/Sample hub.md' }, { path: 'Hub/Other hub.md' }]
    for (let i = 0; i < 2000; i++)
      specs.push({
        path: `Area ${i % 150}/Sample note ${i}.md`,
        frontmatter: { groups: [i % 2 ? '[[Sample hub]]' : '[[Other hub]]'] },
      } as never)
    const vault = useVault(specs)
    const input = document.createElement('input')
    document.body.append(input)
    const app = { ...vault, workspace: { ...vault.workspace, getActiveFile: () => null } }
    const suggest = new ScopeSuggest(
      app as unknown as App,
      input,
      () => taken,
      (e) => chosen.push(e)
    )
    vault.resetStats()
    return { vault, suggest }
  }
  beforeEach(() => vi.restoreAllMocks())

  it('learns the group sizes once for all the letters typed', async () => {
    const { vault, suggest } = big()
    for (const q of ['s', 'sa', 'sam', 'samp', 'sample']) await suggest.getSuggestions(q)
    const once = 2002
    expect(vault.stats.getFileCache).toBeLessThanOrEqual(once)
    expect(vault.stats.getFirstLinkpathDest).toBeLessThanOrEqual(once)
  })

  it('learns them again once a note changes the groups it is in', async () => {
    const { vault, suggest } = big()
    const sizeOf = async () =>
      (await suggest.getSuggestions('hub')).find((c) => c.entry.path === 'Hub/Sample hub.md')?.kind
    expect(await sizeOf()).toBe('group · 1000 notes')
    vault.setFrontmatter('Area 0/Sample note 0.md', { groups: ['[[Sample hub]]'] })
    vault.emit(
      'metadataCache',
      'changed',
      vault.vault.getAbstractFileByPath('Area 0/Sample note 0.md')
    )
    expect(await sizeOf()).toBe('group · 1001 notes')
  })

  it('reads no note metadata while folders alone fill the list', async () => {
    const { vault, suggest } = big()
    expect(await suggest.getSuggestions('')).toHaveLength(100)
    expect(vault.stats.getFileCache).toBe(0)
  })
})
