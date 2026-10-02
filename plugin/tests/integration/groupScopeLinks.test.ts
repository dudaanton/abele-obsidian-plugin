import { describe, expect, it, vi } from 'vitest'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { useVault } from '../helpers/testEnv'

const scope = (path = 'Project/Hub.md') => {
  const resolver = new ScopeResolver()
  resolver.addGroup(path)
  return resolver
}

describe('source-resolved group links', () => {
  it('cannot admit a closed note whose link resolves to another namesake', () => {
    const app = useVault([
      { path: 'Project/Hub.md' },
      { path: 'Separate/Hub.md' },
      { path: 'Separate/Secret.md', frontmatter: { groups: ['[[Hub|group]]'] } },
      { path: 'Project/Member.md', frontmatter: { groups: ['[[Project/Hub]]'] } },
    ])
    vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockImplementation((linkpath, sourcePath) =>
      app.vault.getFileByPath(
        linkpath === 'Hub' && sourcePath === 'Separate/Secret.md'
          ? 'Separate/Hub.md'
          : 'Project/Hub.md'
      )
    )
    const resolver = scope()
    expect(resolver.isInScope('Separate/Secret.md')).toBe(false)
    expect(resolver.isInScope('Project/Member.md')).toBe(true)
  })
  it('rejects a partial folder link resolved elsewhere but accepts the explicit vault path', () => {
    const app = useVault([
      { path: 'First/Groups/Hub.md' },
      { path: 'Second/Groups/Hub.md' },
      { path: 'Notes/Ambiguous.md', frontmatter: { groups: ['[[Groups/Hub]]'] } },
      { path: 'Notes/Explicit.md', frontmatter: { groups: ['[[First/Groups/Hub.md|hub]]'] } },
    ])
    vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockImplementation((linkpath) =>
      app.vault.getFileByPath(
        linkpath === 'Groups/Hub' ? 'Second/Groups/Hub.md' : 'First/Groups/Hub.md'
      )
    )
    const resolver = scope('First/Groups/Hub.md')
    expect(resolver.isInScope('Notes/Ambiguous.md')).toBe(false)
    expect(resolver.isInScope('Notes/Explicit.md')).toBe(true)
  })
  it.each(['Hub', 'Groups/Hub', 'Hub.md|group', 'Hub#Overview'])(
    'admits a short or partial [[%s]] link that Obsidian resolves to the group',
    (link) => {
      const app = useVault([
        { path: 'Project/Groups/Hub.md' },
        { path: 'Separate/Groups/Hub.md' },
        { path: 'Project/Member.md', frontmatter: { groups: [`[[${link}]]`] } },
        { path: 'Separate/Secret.md', frontmatter: { groups: ['[[Hub]]'] } },
        { path: 'Notes/Unresolved.md', frontmatter: { groups: ['[[Missing]]'] } },
      ])
      const resolve = vi
        .spyOn(app.metadataCache, 'getFirstLinkpathDest')
        .mockImplementation((linkpath, sourcePath) => {
          if (linkpath === 'Missing') return null
          return app.vault.getFileByPath(
            sourcePath === 'Project/Member.md' ? 'Project/Groups/Hub.md' : 'Separate/Groups/Hub.md'
          )
        })
      const resolver = scope('Project/Groups/Hub.md')
      expect(resolver.getAccessiblePaths()).toEqual(['Project/Groups/Hub.md', 'Project/Member.md'])
      expect(resolver.resolveGroupPaths('Project/Groups/Hub.md')).toEqual(
        resolver.getAccessiblePaths()
      )
      expect(resolve).toHaveBeenCalledWith(link.split(/[|#]/)[0], 'Project/Member.md')
      expect(resolver.isInScope('Separate/Secret.md')).toBe(false)
      expect(resolver.isInScope('Notes/Unresolved.md')).toBe(false)
    }
  )

  it('keeps unambiguous bare links and full paths even with other equal suffixes', () => {
    useVault([
      { path: 'Project/Hub.md' },
      { path: 'Else/Project/Hub.md' },
      { path: 'Notes/Explicit.md', frontmatter: { groups: ['[[Project/Hub]]'] } },
      { path: 'Project/Unique.md', frontmatter: { groups: ['[[Project/Hub]]'] } },
      { path: 'Project/Nested.md', frontmatter: { groups: ['[[Unique]]'] } },
    ])
    expect(scope().getAccessiblePaths()).toEqual([
      'Notes/Explicit.md',
      'Project/Hub.md',
      'Project/Nested.md',
      'Project/Unique.md',
    ])
  })
  it('does not add an unapproved ban on agent-created group hubs', () => {
    useVault([
      { path: 'Project/Hub.md' },
      { path: 'Project/New.md', frontmatter: { groups: ['[[Project/Hub]]'] } },
      { path: 'Notes/Member.md', frontmatter: { groups: ['[[New]]'] } },
    ])
    const resolver = scope()
    resolver.addFile('Project/New.md')
    expect(resolver.isInScope('Notes/Member.md')).toBe(true)
  })
})
