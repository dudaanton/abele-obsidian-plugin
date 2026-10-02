import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { scopeOf } from '@/ai/toolContext'
import { useVault } from '../helpers/testEnv'

const ROOT = 'Groups/Orchard.md'
const MEMBER = 'Notes/Apples.md'

// Scope membership is deliberately narrower than the footer's backlink walk.
describe('ScopeResolver — group boundaries and invalidation', () => {
  afterEach(() => {
    ScopeResolver.getInstance().destroy()
  })

  it('takes only groups-property members, not body mentions or links in another property', () => {
    useVault([
      { path: ROOT },
      {
        path: MEMBER,
        frontmatter: {
          groups: [null, 7, false, {}, [], 'Orchard', '[[Missing]]', '[[Groups/Orchard|Trees]]'],
        },
      },
      { path: 'Notes/Mention.md', content: '[[Groups/Orchard]]' },
      { path: 'Notes/Other property.md', frontmatter: { related: ['[[Groups/Orchard]]'] } },
      { path: 'Notes/Scalar.md', frontmatter: { groups: '[[Groups/Orchard]]' } },
      { path: 'Notes/Nested.md', frontmatter: { groups: ['[[Notes/Apples]]'] } },
    ])
    const scope = new ScopeResolver()
    scope.addGroup(ROOT)
    expect(scope.getAccessiblePaths()).toEqual([ROOT, MEMBER, 'Notes/Nested.md'])
    expect(scope.resolveGroupPaths(ROOT)).toEqual(scope.getAccessiblePaths())
    expect(scope.resolveGroupPaths('Missing.md')).toEqual([])
  })

  it('refuses names resolved to a different group and accepts explicit paths', () => {
    const app = useVault([
      { path: 'East/Trees.md' },
      { path: 'West/Trees.md' },
      { path: 'East/Apple.md', frontmatter: { groups: ['[[Trees]]'] } },
      { path: 'West/Pear.md', frontmatter: { groups: ['[[Trees]]'] } },
    ])
    // Pin the link destinations independently of the fake vault's basename heuristics.
    vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockImplementation((linkpath) =>
      app.vault.getFileByPath(linkpath === 'Trees' ? 'West/Trees.md' : 'East/Trees.md')
    )
    // Scope derives the group index from the property, not this intentionally empty index.
    for (const key of Object.keys(app.metadataCache.resolvedLinks))
      delete app.metadataCache.resolvedLinks[key]
    const scope = new ScopeResolver()
    scope.addGroup('East/Trees.md')
    expect(scope.getAccessiblePaths()).toEqual(['East/Trees.md'])
    app.setFrontmatter('East/Apple.md', { groups: ['[[East/Trees]]'] })
    scope.invalidate()
    expect(scope.getAccessiblePaths()).toEqual(['East/Apple.md', 'East/Trees.md'])
  })

  it('keeps a cached answer until invalidated, then follows membership edits, moves and deletion', async () => {
    const app = useVault([
      { path: ROOT },
      { path: MEMBER, frontmatter: { groups: ['[[Groups/Orchard]]'] } },
    ])
    const scope = new ScopeResolver()
    scope.addGroup(ROOT)
    const original = scope.resolve()
    app.setFrontmatter(MEMBER, {})
    expect(scope.resolve()).toBe(original)
    expect(scope.isInScope(MEMBER)).toBe(true)
    scope.invalidate()
    expect(scope.getAccessiblePaths()).toEqual([ROOT])

    app.setFrontmatter(MEMBER, { groups: ['[[Groups/Orchard]]'] })
    const file = app.vault.getFileByPath(MEMBER)!
    await app.fileManager.renameFile(file, 'Archive/Apples.md')
    scope.invalidate()
    expect(scope.getAccessiblePaths()).toEqual(['Archive/Apples.md', ROOT])
    await app.vault.delete(file)
    scope.invalidate()
    expect(scope.getAccessiblePaths()).toEqual([ROOT])
  })

  it('shares one reverse index among overlapping group entries and deduplicates diamonds', () => {
    const specs = [
      { path: ROOT },
      { path: MEMBER, frontmatter: { groups: ['[[Groups/Orchard]]'] } },
    ]
    const app = useVault([
      ...specs,
      ...Array.from({ length: 200 }, (_, i) => ({
        path: `Notes/Fruit ${i}.md`,
        frontmatter: { groups: ['[[Groups/Orchard]]', '[[Notes/Apples]]', '[[Notes/Apples]]'] },
      })),
    ])
    const scope = new ScopeResolver()
    scope.addGroup(ROOT)
    scope.addGroup(MEMBER)
    scope.addGroup(ROOT)
    scope.addFile(MEMBER)
    app.resetStats()
    expect(scope.resolve().size).toBe(202)
    expect(app.stats.getFiles).toBe(1)
    expect(app.stats.getFirstLinkpathDest).toBe(601)
    const answer = scope.resolve()
    scope.addGroup(ROOT) // Duplicate mutations do not invalidate an expensive answer.
    expect(scope.resolve()).toBe(answer)
  })

  it('walks a deep group chain iteratively and includes self-groups only once', () => {
    const specs = Array.from({ length: 2500 }, (_, i) => ({
      path: `Chain/Node ${i}.md`,
      frontmatter: { groups: [`[[Chain/Node ${Math.max(0, i - 1)}]]`] },
    }))
    const app = useVault(specs)
    const scope = new ScopeResolver()
    scope.addGroup('Chain/Node 0.md')
    app.resetStats()
    expect(scope.resolve().size).toBe(specs.length)
    expect(app.stats.getFiles).toBe(1)
    expect(app.stats.getFirstLinkpathDest).toBe(specs.length)
  })

  it('uses literal regex punctuation in patterns and ? never crosses a folder separator', () => {
    useVault([
      { path: 'Notes/Plot (a)+[1].md' },
      { path: 'Notes/Plot aaaa1.md' },
      { path: 'Notes/A/B.md' },
      { path: 'Notes/AxB.md' },
    ])
    const scope = new ScopeResolver()
    scope.addPattern('Notes/Plot (a)+[1].md')
    scope.addPattern('Notes/A?B.md')
    scope.addPattern('Notes/A?B.md')
    expect(scope.getAccessiblePaths()).toEqual(['Notes/AxB.md', 'Notes/Plot (a)+[1].md'])
    expect(scope.entries.value).toHaveLength(2)
    scope.remove({ type: 'pattern', path: 'Notes/A?B.md' })
    expect(scope.getAccessiblePaths()).toEqual(['Notes/Plot (a)+[1].md'])
  })

  it('does not confuse sibling folder prefixes and accepts an explicitly scoped empty folder', () => {
    useVault([{ path: 'Notes/A.md' }, { path: 'NotesExtra/B.md' }])
    const scope = new ScopeResolver()
    scope.addFolder('Notes///')
    scope.addFolder('Empty///')
    expect(scope.isFolderInScope('Empty/')).toBe(true)
    expect(scope.isFolderInScope('NotesExtra')).toBe(false)
    expect(scope.getAccessiblePaths()).toEqual(['Notes/A.md'])
    scope.setFullVaultAccess(true)
    expect(scope.getAccessiblePaths()).toEqual(['Notes/A.md', 'NotesExtra/B.md'])
    scope.setFullVaultAccess(false)
    expect(scope.getAccessiblePaths()).toEqual(['Notes/A.md'])
  })

  it('selects the call context without replacing the default, then replaces a destroyed singleton', () => {
    useVault([])
    const original = ScopeResolver.getInstance()
    original.addFile('Notes/Default.md')
    const session = new ScopeResolver()
    session.addFile('Notes/Session.md')
    expect(scopeOf({ scope: session, interactive: true })).toBe(session)
    expect(scopeOf()).toBe(original)
    expect(ScopeResolver.getInstance()).toBe(original)
    original.destroy()
    expect(original.entries.value).toEqual([])
    expect(ScopeResolver.getInstance()).not.toBe(original)
    expect(ScopeResolver.getInstance().getAccessiblePaths()).toEqual([])
  })
})
