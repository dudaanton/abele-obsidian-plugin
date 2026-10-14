import { describe, expect, it } from 'vitest'
import { changedTree } from '@/components/nodeWork/changedTree'
import type { FileChange, TreeEntry } from '@/components/nodeWork/types'

const change = (path: string, kind: FileChange['kind'] = 'modified'): FileChange => ({
  path,
  kind,
  added: 1,
  removed: 0,
  before: '',
  after: '',
})
const shape = (list: TreeEntry[]): unknown[] =>
  list.map((e) => (e.kind === 'folder' ? { [e.name]: shape(e.children ?? []) } : e.name))

describe('the changed files in their folders', () => {
  it('keeps only the folders that hold changes, folders before files, each by name', () => {
    const tree = changedTree([
      change('readme.md'),
      change('src/sample/beta.ts'),
      change('src/sample/alpha.ts', 'added'),
      change('src/main.ts'),
      change('docs/guide.md', 'deleted'),
    ])
    expect(shape(tree)).toEqual([
      { docs: ['guide.md'] },
      { src: [{ sample: ['alpha.ts', 'beta.ts'] }, 'main.ts'] },
      'readme.md',
    ])
  })

  it('joins a folder whose only entry is a folder into one row, keeping the deepest path', () => {
    const tree = changedTree([change('src/components/deep/sample.vue')])
    expect(tree[0]).toMatchObject({ name: 'src/components/deep', path: 'src/components/deep' })
    expect(tree[0].children?.[0]).toMatchObject({ name: 'sample.vue', kind: 'file' })
    expect(tree[0].children?.[0].change?.path).toBe('src/components/deep/sample.vue')
  })

  it('is empty when nothing changed', () => {
    expect(changedTree([])).toEqual([])
  })
})
