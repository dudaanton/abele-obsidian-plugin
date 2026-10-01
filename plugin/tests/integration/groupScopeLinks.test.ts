import { describe, expect, it, vi } from 'vitest'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { useVault } from '../helpers/testEnv'

const scope = (path = 'Project/Hub.md') => {
  const resolver = new ScopeResolver()
  resolver.addGroup(path)
  return resolver
}

describe('ambiguous group links', () => {
  it('cannot admit a closed note just because Obsidian picks the accessible namesake', () => {
    const app = useVault([
      { path: 'Project/Hub.md' },
      { path: 'Separate/Hub.md' },
      { path: 'Separate/Secret.md', frontmatter: { groups: ['[[Hub|group]]'] } },
      { path: 'Project/Member.md', frontmatter: { groups: ['[[Project/Hub]]'] } },
    ])
    vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockImplementation(
      () => app.vault.getAbstractFileByPath('Project/Hub.md') as never
    )
    const resolver = scope()
    expect(resolver.isInScope('Separate/Secret.md')).toBe(false)
    expect(resolver.isInScope('Project/Member.md')).toBe(true)
  })
  it('rejects an ambiguous partial folder path but accepts the explicit vault path', () => {
    const app = useVault([
      { path: 'First/Groups/Hub.md' },
      { path: 'Second/Groups/Hub.md' },
      { path: 'Notes/Ambiguous.md', frontmatter: { groups: ['[[Groups/Hub]]'] } },
      { path: 'Notes/Explicit.md', frontmatter: { groups: ['[[First/Groups/Hub.md|hub]]'] } },
    ])
    vi.spyOn(app.metadataCache, 'getFirstLinkpathDest').mockImplementation(
      () => app.vault.getAbstractFileByPath('First/Groups/Hub.md') as never
    )
    const resolver = scope('First/Groups/Hub.md')
    expect(resolver.isInScope('Notes/Ambiguous.md')).toBe(false)
    expect(resolver.isInScope('Notes/Explicit.md')).toBe(true)
  })
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
