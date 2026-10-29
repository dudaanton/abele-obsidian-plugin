import { TabCode } from '@/github/search/tabCode'
import { clientWith } from '../helpers/githubTab'
import { Notice } from 'obsidian'
import { expect, it, vi } from 'vitest'
import { importedPaths, resolveImport } from '@/github/search/imports'
import { buildTree } from '@/github/tree/fileTree'

it('recognizes module strings, excluding packages and ordinary strings', () => {
  expect(
    importedPaths(
      `import x from './x'; export * from '../y'; require('./z'); import('./lazy')`
    ).map((x) => x.text)
  ).toEqual(['./x', '../y', './z', './lazy'])
  expect(
    importedPaths(`const x = './x'; import x from 'package'; export default './ordinary'`)
  ).toEqual([])
})
it('resolves exact, extension and directory candidates in order without escaping root', async () => {
  const root = buildTree(
    ['src/x', 'src/x.ts', 'src/dir/index.tsx', 'types.d.ts'].map((path) => ({ path, type: 'blob' }))
  )
  const tree = { root, reveal: async () => {} }
  expect(await resolveImport(tree, 'src/app.ts', './x')).toBe('src/x')
  expect(await resolveImport(tree, 'src/app.ts', './dir')).toBe('src/dir/index.tsx')
  expect(await resolveImport(tree, 'src/app.ts', '../types')).toBe('types.d.ts')
  expect(await resolveImport(tree, 'src/app.ts', '../../types')).toBeNull()
  expect(await resolveImport(tree, 'src/app.ts', './missing')).toBeNull()
})

it('ignores module-like text in comments and strings and supports multiline declarations', () => {
  expect(
    importedPaths(`// import x from "./comment"
const message = 'require("./message")';
/* export * from "./comment" */
import {
  sample
} from "./real"`).map((path) => path.text)
  ).toEqual(['./real'])
})

it('reuses the repository tree and opens only resolved files at the captured ref', async () => {
  const { client, request } = clientWith({
    '/repos/sample/project/git/trees/sample-sha': {
      json: { tree: [{ path: 'src/target.ts', type: 'blob' }] },
    },
  })
  const open = vi.fn()
  const code = new TabCode({
    client: () => client,
    repo: () => ({ host: 'github.com', owner: 'sample', repo: 'project' }),
    refLabel: () => 'topic',
    sha: async () => 'sample-sha',
    blob: () => ({ path: 'src/app.ts', text: '' }),
    changes: async () => null,
    limitBytes: () => 1000,
    open,
    showReferences: vi.fn(),
    pick: vi.fn(),
  })
  await code.openImport('./target', 'src/app.ts')
  expect(open).toHaveBeenCalledWith(
    'https://github.com/sample/project/blob/sample-sha/src/target.ts',
    false
  )
  open.mockClear()
  Notice.shown.length = 0
  await code.openImport('./absent', 'src/app.ts')
  expect(open).not.toHaveBeenCalled()
  expect(Notice.shown).toEqual(['Imported file not found.'])
  expect(request).toHaveBeenCalledTimes(1)
})
