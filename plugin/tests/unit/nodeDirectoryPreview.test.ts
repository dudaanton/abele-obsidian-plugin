import { expect, it, vi } from 'vitest'
import { directoryPreview } from '@/node/nodeDirectoryPreview'

it('counts the root folder without rendering a slash and marks staged, unstaged and untracked files', async () => {
  const entries = [
    { path: '', kind: 'directory' },
    { path: 'nested', kind: 'directory' },
    ...['clean.ts', 'edited.ts', 'staged.ts', 'new.ts', 'ignored.ts'].map((path) => ({
      path: 'nested/' + path,
      kind: 'file',
    })),
  ] as never
  const page = (entries: unknown[]) => ({ entries, cursor: null, incomplete: false, omissions: [] })
  const client = {
    repository: {
      observe: async () => ({ revision: { kind: 'working', head: 'a'.repeat(40) } }),
      status: async () =>
        page([
          { path: 'src/nested/edited.ts', index: ' ', worktree: 'M' },
          { path: 'src/nested/staged.ts', index: 'M', worktree: ' ' },
          { path: 'src/nested/new.ts', index: '?', worktree: '?' },
        ]),
      tree: vi.fn(async () =>
        page(
          ['clean.ts', 'edited.ts', 'staged.ts'].map((name) => ({
            path: 'src/nested/' + name,
            kind: 'file',
          }))
        )
      ),
    },
  }
  const result = await directoryPreview(
    client as never,
    { kind: 'worktree', id: 'sample' } as never,
    'src',
    entries
  )
  expect(result.files).toBe(5)
  expect(result.folders).toBe(2)
  expect(result.details.items.map((row) => row.path)).toEqual([
    'nested/',
    'nested/clean.ts',
    'nested/edited.ts',
    'nested/staged.ts',
    'nested/new.ts',
    'nested/ignored.ts',
  ])
  expect(
    result.details.items.filter((row) => row.badge).map((row) => [row.path, row.badge])
  ).toEqual([
    ['nested/edited.ts', 'Uncommitted'],
    ['nested/staged.ts', 'Uncommitted'],
    ['nested/new.ts', 'Untracked'],
    ['nested/ignored.ts', 'Untracked'],
  ])
})

it('never implies Git recovery when status cannot be read', async () => {
  const result = await directoryPreview(
    {
      repository: {
        observe: async () => {
          throw Error('disconnected')
        },
      },
    } as never,
    { kind: 'worktree', id: 'sample' } as never,
    'src',
    [
      { path: '', kind: 'directory' },
      { path: 'draft.ts', kind: 'file' },
    ]
  )
  expect(result.details.items).toEqual([
    { path: 'draft.ts', folder: false, badge: 'Git status unavailable' },
  ])
})

it('counts an empty root without producing a meaningless list row', async () => {
  const result = await directoryPreview(
    {} as never,
    { kind: 'workspace', id: 'sample' } as never,
    'src',
    [{ path: '', kind: 'directory' }]
  )
  expect(result.files).toBe(0)
  expect(result.folders).toBe(1)
  expect(result.details.items).toEqual([])
})
