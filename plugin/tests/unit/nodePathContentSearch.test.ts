import { expect, it, vi } from 'vitest'
import { searchNodePathCode } from '@/node/NodePathSearch'
import { resolveNodeCodeLink } from '@/node/codeLinks'
import type { RepositoryRevision } from '@abele/node-protocol'

const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-registration',
  projectId: 'sample-project',
  kind: 'worktree' as const,
  id: 'sample-tree',
}
const query = { text: 'needle', caseSensitive: false, regex: false, wholeWord: false }

it('explains an invalid pattern without exposing the regex engine message', async () => {
  await expect(
    searchNodePathCode({} as never, target, 'repo', { ...query, text: '[sample', regex: true }, '')
  ).rejects.toThrow('Check the regular expression and try again.')
})
const revision = {
  kind: 'working',
  observation_id: 'sample-observation',
  observed_at: '2026-01-01T00:00:00Z',
  head: 'a'.repeat(40),
} satisfies RepositoryRevision
const row = (path: string, line: number) => ({
  path,
  line,
  text: 'the Needle here',
  content_id: null,
})
const page = (entries = [row('sample.ts', 7)], cursor: string | null = null) => ({
  entries,
  cursor,
  incomplete: false,
  omissions: [] as string[],
})
it.each(['worktree', 'workspace'] as const)(
  'continues empty scan pages before returning %s content or filename results',
  async (kind) => {
    for (const scope of ['repo', 'names'] as const) {
      const search = vi
        .fn()
        .mockResolvedValueOnce(page([], 'scan-1'))
        .mockResolvedValueOnce(page([], 'scan-2'))
        .mockResolvedValueOnce(
          page([row('tests/sample.test.ts', 8), row('spec/sample.spec.ts', 3)])
        )
      const repository = { observe: vi.fn(async () => ({ revision })), search }
      const result = await searchNodePathCode(
        { repository, nodePath: { search } } as never,
        { ...target, kind },
        scope,
        query,
        ''
      )
      expect(result.files.map((f) => f.path)).toEqual([
        'tests/sample.test.ts',
        'spec/sample.spec.ts',
      ])
      expect(result.total).toBe(2)
      expect(result.next).toBeUndefined()
      expect(search.mock.calls.map(([p]) => p.cursor)).toEqual([undefined, 'scan-1', 'scan-2'])
      expect(search.mock.calls[2][0].mode).toBe(scope === 'names' ? 'filename' : 'literal')
    }
  }
)
it('searches content, highlights it and pages the same observation without dropping earlier results', async () => {
  const repository = {
    observe: vi.fn(async () => ({ revision })),
    search: vi
      .fn()
      .mockResolvedValueOnce(page(undefined, 'sample-cursor'))
      .mockResolvedValueOnce(page([row('other.ts', 3)])),
  }
  const result = await searchNodePathCode({ repository } as never, target, 'repo', query, '*.ts')
  expect(repository.search).toHaveBeenCalledWith(
    expect.objectContaining({
      mode: 'literal',
      query: 'needle',
      path_glob: '*.ts',
      revision,
      scope: 'repository',
    })
  )
  expect(result.files[0].lines[0]).toMatchObject({ label: '7', column: 4, length: 6 })
  expect(resolveNodeCodeLink(result.files[0].lines[0].url, target)).toMatchObject({
    path: 'sample.ts',
    line: 7,
  })
  expect(result.next).toBeTypeOf('function')
  const next = await result.next!()
  expect(next.files.map((f) => f.path)).toEqual(['sample.ts', 'other.ts'])
  expect(next.total).toBe(2)
  expect(next.next).toBeUndefined()
  expect(repository.observe).toHaveBeenCalledTimes(1)
  expect(repository.search.mock.calls[1][0]).toMatchObject({ revision, cursor: 'sample-cursor' })
})
it('uses plain-folder content search and keeps partial matches with a readable omissions notice', async () => {
  const nodePath = {
    search: vi.fn(async () => ({ ...page(), incomplete: true, omissions: ['scan limit'] })),
  }
  const result = await searchNodePathCode(
    { nodePath } as never,
    { ...target, kind: 'workspace' },
    'repo',
    { ...query, regex: true, wholeWord: true },
    ''
  )
  expect(nodePath.search).toHaveBeenCalledWith(
    expect.objectContaining({ workspace_id: target.id, mode: 'regex', case_sensitive: false })
  )
  expect(result.files).toHaveLength(1)
  expect(result.capped).toBe(true)
  expect(result.note).toContain('Some files or matches were omitted')
})
it('keeps filename mode available and cancels before transport', async () => {
  const nodePath = {
    search: vi.fn(async () => page([{ ...row('sample.ts', 0), text: 'sample.ts' }])),
  }
  const result = await searchNodePathCode(
    { nodePath } as never,
    { ...target, kind: 'workspace' },
    'names',
    query,
    ''
  )
  expect(nodePath.search).toHaveBeenCalledWith(expect.objectContaining({ mode: 'filename' }))
  expect(result.files[0].lines).toEqual([])
  const abort = new AbortController()
  abort.abort()
  await expect(
    searchNodePathCode({ nodePath } as never, target, 'repo', query, '', abort.signal)
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(nodePath.search).toHaveBeenCalledTimes(1)
})
it('keeps the incomplete-coverage warning after the last page and ignores a later target switch', async () => {
  const selected = { ...target, kind: 'workspace' as const }
  const nodePath = {
    search: vi
      .fn()
      .mockResolvedValueOnce({
        ...page(undefined, 'sample-cursor'),
        incomplete: true,
        omissions: ['binary files skipped'],
      })
      .mockResolvedValueOnce(page([])),
  }
  const first = await searchNodePathCode({ nodePath } as never, selected, 'repo', query, '')
  selected.id = 'other-workspace'
  const last = await first.next!()
  expect(nodePath.search.mock.calls[1][0].workspace_id).toBe(target.id)
  expect(last.capped).toBe(true)
  expect(last.note).toBe(first.note)
})

it('bounds automatic scanning and lets a later continuation resume without losing its cursor', async () => {
  const search = vi.fn(async (_params: { cursor?: string }) =>
    page([], `scan-${search.mock.calls.length}`)
  )
  const result = await searchNodePathCode(
    { nodePath: { search } } as never,
    { ...target, kind: 'workspace' },
    'repo',
    query,
    ''
  )
  expect(search).toHaveBeenCalledTimes(32)
  expect(result.capped).toBe(true)
  expect(result.next).toBeTypeOf('function')
  search.mockResolvedValueOnce(page())
  const last = await result.next!()
  expect(search.mock.calls.at(-1)?.[0]).toMatchObject({ cursor: 'scan-32' })
  expect(last.total).toBe(1)
})

it('yields a continuation after the scan time budget and stops repeated cursors', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(0)
  try {
    const search = vi.fn(async () => {
      clock.mockReturnValue(10_000)
      return page([], 'same-cursor')
    })
    const result = await searchNodePathCode(
      { nodePath: { search } } as never,
      { ...target, kind: 'workspace' },
      'repo',
      query,
      ''
    )
    expect(search).toHaveBeenCalledTimes(1)
    expect(result.next).toBeTypeOf('function')
    const last = await result.next!()
    expect(search).toHaveBeenCalledTimes(2)
    expect(last.next).toBeUndefined()
    expect(last.note).toContain('Some files or matches were omitted')
  } finally {
    clock.mockRestore()
  }
})

it('cancels between empty scan pages and while a page is in flight', async () => {
  const abort = new AbortController()
  const search = vi
    .fn()
    .mockResolvedValueOnce(page([], 'scan-1'))
    .mockImplementationOnce(async () => {
      abort.abort()
      return page([], 'scan-2')
    })
  await expect(
    searchNodePathCode(
      { nodePath: { search } } as never,
      { ...target, kind: 'workspace' },
      'repo',
      query,
      '',
      abort.signal
    )
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(search).toHaveBeenCalledTimes(2)
})
