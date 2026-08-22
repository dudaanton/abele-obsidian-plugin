/**
 * Behavioural contract for ScopeResolver.
 *
 * ScopeResolver decides which files the AI agent is allowed to touch, so these tests exist
 * to pin the CURRENT semantics before the group-resolution rewrite. A refactor that makes
 * resolution faster but quietly widens the returned set is a security regression, not an
 * optimisation — these assertions are what makes that visible.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { buildFakeVault, type FakeApp, type FakeFileSpec } from '../helpers/fakeVault'

function useVault(specs: FakeFileSpec[]): FakeApp {
  const app = buildFakeVault(specs)
  // GlobalStore.init() also spins up a VaultWatcher and registers vault callbacks, none of
  // which this unit needs. Assigning the backing field keeps the fixture to just the app.
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
  return app
}

/** A fresh, non-singleton resolver so tests cannot leak scope state into each other. */
function newResolver(): ScopeResolver {
  return new ScopeResolver()
}

describe('ScopeResolver — file and folder entries', () => {
  beforeEach(() => {
    useVault([
      { path: 'Notes/A.md' },
      { path: 'Notes/B.md' },
      { path: 'Notes/Sub/C.md' },
      { path: 'Notes/Sub/Deep/D.md' },
      { path: 'Other/E.md' },
    ])
  })

  it('resolves a file entry to exactly that path', () => {
    const scope = newResolver()
    scope.addFile('Notes/A.md')
    expect([...scope.resolve()]).toEqual(['Notes/A.md'])
  })

  it('adds a file entry without requiring the file to exist in the vault', () => {
    const scope = newResolver()
    scope.addFile('Ghost/Missing.md')
    expect(scope.isInScope('Ghost/Missing.md')).toBe(true)
  })

  it('resolves a folder entry recursively through nested subfolders', () => {
    const scope = newResolver()
    scope.addFolder('Notes')
    expect(scope.getAccessiblePaths()).toEqual([
      'Notes/A.md',
      'Notes/B.md',
      'Notes/Sub/C.md',
      'Notes/Sub/Deep/D.md',
    ])
  })

  it('strips trailing slashes when adding a folder', () => {
    const scope = newResolver()
    scope.addFolder('Notes/')
    expect(scope.getAccessiblePaths()).toContain('Notes/A.md')
  })

  it('does not add duplicate entries for the same path', () => {
    const scope = newResolver()
    scope.addFile('Notes/A.md')
    scope.addFile('Notes/A.md')
    scope.addFolder('Notes')
    scope.addFolder('Notes')
    expect(scope.entries.value).toHaveLength(2)
  })

  it('reports a folder as in scope via a parent folder entry', () => {
    const scope = newResolver()
    scope.addFolder('Notes')
    expect(scope.isFolderInScope('Notes/Sub')).toBe(true)
  })

  it('reports a folder as in scope when only a file inside it was added', () => {
    const scope = newResolver()
    scope.addFile('Notes/Sub/C.md')
    expect(scope.isFolderInScope('Notes/Sub')).toBe(true)
  })

  it('reports an unrelated folder as out of scope', () => {
    const scope = newResolver()
    scope.addFolder('Notes')
    expect(scope.isFolderInScope('Other')).toBe(false)
  })
})

describe('ScopeResolver — full vault access', () => {
  beforeEach(() => {
    useVault([{ path: 'Notes/A.md' }, { path: 'Other/E.md' }])
  })

  it('short-circuits isInScope for any path, even one not in the vault', () => {
    const scope = newResolver()
    scope.setFullVaultAccess(true)
    expect(scope.isInScope('Anything/At/All.md')).toBe(true)
    expect(scope.isFolderInScope('Anywhere')).toBe(true)
  })

  it('resolves to every file in the vault', () => {
    const scope = newResolver()
    scope.setFullVaultAccess(true)
    expect(scope.getAccessiblePaths()).toEqual(['Notes/A.md', 'Other/E.md'])
  })

  it('returns the input unchanged from filterInScope', () => {
    const scope = newResolver()
    scope.setFullVaultAccess(true)
    expect(scope.filterInScope(['nope.md'])).toEqual(['nope.md'])
  })
})

describe('ScopeResolver — pattern entries', () => {
  beforeEach(() => {
    useVault([
      { path: 'Notes/A.md' },
      { path: 'Notes/Sub/C.md' },
      { path: 'Notes/Sub/Deep/D.md' },
      { path: 'Other/E.md' },
      { path: 'Other/E.txt' },
    ])
  })

  it('matches a single path segment with *', () => {
    const scope = newResolver()
    scope.addPattern('Notes/*.md')
    expect(scope.getAccessiblePaths()).toEqual(['Notes/A.md'])
  })

  it('crosses folder boundaries with **', () => {
    const scope = newResolver()
    scope.addPattern('Notes/**/*.md')
    expect(scope.getAccessiblePaths()).toEqual(['Notes/Sub/C.md', 'Notes/Sub/Deep/D.md'])
  })

  it('matches a single character with ?', () => {
    const scope = newResolver()
    scope.addPattern('Other/?.txt')
    expect(scope.getAccessiblePaths()).toEqual(['Other/E.txt'])
  })

  it('matches case-insensitively', () => {
    const scope = newResolver()
    scope.addPattern('notes/a.md')
    expect(scope.getAccessiblePaths()).toEqual(['Notes/A.md'])
  })
})

// The group tree used below. Arrows point from a member to the group it belongs to:
//   Notes/Movies.md          (group root, no `groups` of its own)
//     Notes/Interstellar.md  -> [[Movies]]
//     Notes/SciFi.md         -> [[Movies]]          (itself a group)
//       Notes/Dune.md        -> [[SciFi]]           (transitive, depth 2)
//   Notes/Books.md           (unrelated group)
//     Notes/Hail Mary.md     -> [[Books]]
const GROUP_VAULT: FakeFileSpec[] = [
  { path: 'Notes/Movies.md' },
  { path: 'Notes/Interstellar.md', frontmatter: { groups: ['[[Movies]]'] } },
  { path: 'Notes/SciFi.md', frontmatter: { groups: ['[[Movies]]'] } },
  { path: 'Notes/Dune.md', frontmatter: { groups: ['[[SciFi]]'] } },
  { path: 'Notes/Books.md' },
  { path: 'Notes/Hail Mary.md', frontmatter: { groups: ['[[Books]]'] } },
  { path: 'Notes/Loose.md' },
]

describe('ScopeResolver — group entries', () => {
  beforeEach(() => {
    useVault(GROUP_VAULT)
  })

  it('includes the group note itself', () => {
    const scope = newResolver()
    scope.addGroup('Notes/Books.md')
    expect(scope.getAccessiblePaths()).toContain('Notes/Books.md')
  })

  it('includes direct members', () => {
    const scope = newResolver()
    scope.addGroup('Notes/Books.md')
    expect(scope.getAccessiblePaths()).toEqual(['Notes/Books.md', 'Notes/Hail Mary.md'])
  })

  it('descends transitively into nested groups', () => {
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')
    expect(scope.getAccessiblePaths()).toEqual([
      'Notes/Dune.md',
      'Notes/Interstellar.md',
      'Notes/Movies.md',
      'Notes/SciFi.md',
    ])
  })

  it('does not leak members of an unrelated group', () => {
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')
    const paths = scope.getAccessiblePaths()
    expect(paths).not.toContain('Notes/Hail Mary.md')
    expect(paths).not.toContain('Notes/Loose.md')
  })

  it('resolves a group linked by full path and by alias', () => {
    useVault([
      { path: 'Notes/Movies.md' },
      { path: 'Notes/ByPath.md', frontmatter: { groups: ['[[Notes/Movies]]'] } },
      { path: 'Notes/ByAlias.md', frontmatter: { groups: ['[[Notes/Movies|Films]]'] } },
    ])
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')
    expect(scope.getAccessiblePaths()).toEqual([
      'Notes/ByAlias.md',
      'Notes/ByPath.md',
      'Notes/Movies.md',
    ])
  })

  it('terminates on a cycle instead of recursing forever', () => {
    useVault([
      { path: 'Notes/A.md', frontmatter: { groups: ['[[B]]'] } },
      { path: 'Notes/B.md', frontmatter: { groups: ['[[A]]'] } },
    ])
    const scope = newResolver()
    scope.addGroup('Notes/A.md')
    expect(scope.getAccessiblePaths()).toEqual(['Notes/A.md', 'Notes/B.md'])
  })

  it('ignores a groups value that is not an array', () => {
    useVault([
      { path: 'Notes/Movies.md' },
      { path: 'Notes/Bad.md', frontmatter: { groups: '[[Movies]]' } },
    ])
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')
    expect(scope.getAccessiblePaths()).toEqual(['Notes/Movies.md'])
  })

  it('ignores group entries that are not wikilinks', () => {
    useVault([
      { path: 'Notes/Movies.md' },
      { path: 'Notes/Plain.md', frontmatter: { groups: ['Movies'] } },
    ])
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')
    expect(scope.getAccessiblePaths()).toEqual(['Notes/Movies.md'])
  })

  it('ignores a wikilink that resolves to nothing', () => {
    useVault([
      { path: 'Notes/Movies.md' },
      { path: 'Notes/Dangling.md', frontmatter: { groups: ['[[Nonexistent]]'] } },
    ])
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')
    expect(scope.getAccessiblePaths()).toEqual(['Notes/Movies.md'])
  })

  it('includes a note that belongs to several groups from each of them', () => {
    useVault([
      { path: 'Notes/Movies.md' },
      { path: 'Notes/Books.md' },
      { path: 'Notes/Both.md', frontmatter: { groups: ['[[Movies]]', '[[Books]]'] } },
    ])

    const viaMovies = newResolver()
    viaMovies.addGroup('Notes/Movies.md')
    expect(viaMovies.getAccessiblePaths()).toContain('Notes/Both.md')

    const viaBooks = newResolver()
    viaBooks.addGroup('Notes/Books.md')
    expect(viaBooks.getAccessiblePaths()).toContain('Notes/Both.md')
  })
})

describe('ScopeResolver — caching', () => {
  beforeEach(() => {
    useVault(GROUP_VAULT)
  })

  it('serves a repeated resolve from cache without re-scanning the vault', () => {
    const app = useVault(GROUP_VAULT)
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')

    scope.resolve()
    const afterFirst = app.stats.getFiles
    expect(afterFirst).toBeGreaterThan(0)

    scope.resolve()
    expect(app.stats.getFiles).toBe(afterFirst)
  })

  it('recomputes after an explicit invalidate', () => {
    const app = useVault(GROUP_VAULT)
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')

    scope.resolve()
    const afterFirst = app.stats.getFiles

    scope.invalidate()
    scope.resolve()
    expect(app.stats.getFiles).toBeGreaterThan(afterFirst)
  })

  it('drops the cache when a file entry is added', () => {
    // Pins today's behaviour, which is what makes agent tool approval expensive:
    // ChatSession.approveToolCall() calls addFile() and then immediately runs a tool that
    // calls isInScope(), forcing a full group re-resolution on every out-of-scope approval.
    const app = useVault(GROUP_VAULT)
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')

    scope.resolve()
    const afterFirst = app.stats.getFiles

    scope.addFile('Notes/Loose.md')
    scope.resolve()

    expect(app.stats.getFiles).toBeGreaterThan(afterFirst)
  })

  it('reflects a newly added file in the resolved set', () => {
    const scope = newResolver()
    scope.addGroup('Notes/Books.md')
    scope.resolve()

    scope.addFile('Notes/Loose.md')
    expect(scope.isInScope('Notes/Loose.md')).toBe(true)
  })

  it('drops removed entries from the resolved set', () => {
    const scope = newResolver()
    scope.addFile('Notes/Loose.md')
    expect(scope.isInScope('Notes/Loose.md')).toBe(true)

    scope.remove({ type: 'file', path: 'Notes/Loose.md' })
    expect(scope.isInScope('Notes/Loose.md')).toBe(false)
  })

  it('clears everything on clear()', () => {
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')
    scope.setFullVaultAccess(true)
    scope.clear()

    expect(scope.entries.value).toEqual([])
    expect(scope.fullVaultAccess.value).toBe(false)
    expect(scope.getAccessiblePaths()).toEqual([])
  })
})

describe('ScopeResolver — filtering helpers', () => {
  beforeEach(() => {
    useVault(GROUP_VAULT)
  })

  it('filterInScope keeps only resolved paths and preserves order', () => {
    const scope = newResolver()
    scope.addGroup('Notes/Books.md')
    expect(scope.filterInScope(['Notes/Loose.md', 'Notes/Hail Mary.md', 'Notes/Books.md'])).toEqual(
      ['Notes/Hail Mary.md', 'Notes/Books.md']
    )
  })

  it('getAccessiblePaths returns a sorted array', () => {
    const scope = newResolver()
    scope.addGroup('Notes/Movies.md')
    const paths = scope.getAccessiblePaths()
    expect(paths).toEqual([...paths].sort())
  })
})

describe('ScopeResolver — summary and preview', () => {
  beforeEach(() => {
    useVault(GROUP_VAULT)
  })

  it('summarises an empty scope', () => {
    const scope = newResolver()
    expect(scope.summary.value).toBe('No files')
    expect(scope.preview.value).toBe('')
  })

  it('summarises full vault access', () => {
    const scope = newResolver()
    scope.setFullVaultAccess(true)
    expect(scope.summary.value).toBe('Full vault')
    expect(scope.preview.value).toBe('Full vault access')
  })

  it('pluralises and joins mixed entry kinds', () => {
    const scope = newResolver()
    scope.addFile('Notes/A.md')
    scope.addFile('Notes/B.md')
    scope.addFolder('Notes')
    scope.addPattern('**/*.md')
    scope.addGroup('Notes/Movies.md')
    expect(scope.summary.value).toBe('2 files, 1 folder, 1 pattern, 1 group')
  })

  it('previews the first two names and counts the rest', () => {
    const scope = newResolver()
    scope.addFile('Notes/A.md')
    scope.addFile('Notes/B.md')
    scope.addFile('Notes/C.md')
    expect(scope.preview.value).toBe('A.md, B.md +1')
  })
})
