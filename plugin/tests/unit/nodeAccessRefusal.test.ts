import { describe, expect, it } from 'vitest'
import { accessCovers } from '@/ai/tools/node/accessRefusal'
import { nodeScopeSentence, nodeScopeTitle, shortBranch } from '@/ai/tools/node/scopeNames'

const want = {
  node_id: 'n1',
  project_id: 'p1',
  target: { kind: 'worktree' as const, worktree_id: 'w2' },
}

describe('a refused node call and the access that lets it through', () => {
  it('is let through by the node, its folder or that worktree, and by nothing narrower or elsewhere', () => {
    expect(accessCovers([{ kind: 'node', node_id: 'n1' }], want)).toBe(true)
    expect(accessCovers([{ kind: 'project', node_id: 'n1', project_id: 'p1' }], want)).toBe(true)
    expect(
      accessCovers([{ kind: 'target', node_id: 'n1', project_id: 'p1', target: want.target }], want)
    ).toBe(true)
    expect(
      accessCovers(
        [
          {
            kind: 'target',
            node_id: 'n1',
            project_id: 'p1',
            target: { kind: 'worktree', worktree_id: 'w1' },
          },
        ],
        want
      )
    ).toBe(false)
    expect(accessCovers([{ kind: 'project', node_id: 'n1', project_id: 'p9' }], want)).toBe(false)
    expect(accessCovers([{ kind: 'node', node_id: 'n2' }], want)).toBe(false)
  })

  it('says a place by its names, never its ids', () => {
    const names = { node: 'sample-node', folder: 'sample-folder', branch: 'sample-branch' }
    expect(nodeScopeTitle(names)).toBe('sample-folder / sample-branch')
    expect(nodeScopeTitle({ node: 'sample-node' })).toBe('sample-node')
    expect(nodeScopeSentence(names, 'read')).toBe(
      'sample-node node · sample-folder · worktree sample-branch · can read files'
    )
  })
})

describe('a branch on screen', () => {
  it('is said the way people say it, not as its full ref', () => {
    expect(shortBranch('refs/heads/main')).toBe('main')
    expect(shortBranch('sample-branch')).toBe('sample-branch')
    expect(shortBranch(null)).toBe('')
  })
})
