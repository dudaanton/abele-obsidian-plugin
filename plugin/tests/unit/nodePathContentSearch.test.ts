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
