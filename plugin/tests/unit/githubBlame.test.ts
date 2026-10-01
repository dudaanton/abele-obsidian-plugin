import { describe, expect, it, vi } from 'vitest'
import { GithubClient, GithubError } from '@/github/client'
import { endpoints } from '@/github/urls'
import { loadBlame, rangeAt } from '@/github/blame'

const file = {
  host: 'github.com',
  owner: 'sample-org',
  repo: 'sample-repo',
  ref: 'topic/branch',
  path: 'src/sample.ts',
}
const commit = {
  oid: 'a'.repeat(40),
  message: 'Sample change\n\nFull explanation',
  committedDate: '2025-01-02T12:00:00Z',
  author: { name: 'Sample Author', avatarUrl: 'https://example.com/avatar', user: null },
}
const data = {
  repository: {
    object: {
      blame: {
        ranges: [
          { startingLine: 1, endingLine: 3, commit },
          { startingLine: 4, endingLine: 5, commit },
          { startingLine: 6, endingLine: 8, commit: { ...commit, oid: 'b'.repeat(40) } },
        ],
      },
    },
  },
}
function client() {
  const c = new GithubClient(endpoints(''), 'sample-token')
  vi.spyOn(c, 'graphql').mockResolvedValue(data)
  return c
}

describe('file blame', () => {
  it('names blame, not discussions, when GraphQL requires a token', async () => {
    const c = new GithubClient(endpoints(''), '')
    await expect(loadBlame(c, file)).rejects.toThrow("the file's line blame")
  })
  it('queries the exact ref/path, maps unlinked authors and groups adjacent ranges', async () => {
    const c = client()
    const ranges = await loadBlame(c, file)
    expect(c.graphql).toHaveBeenCalledWith(
      expect.stringContaining('blame(path: $path)'),
      { owner: file.owner, repo: file.repo, ref: file.ref, path: file.path },
      "the file's line blame"
    )
    expect(ranges).toHaveLength(2)
    expect(ranges[0]).toEqual({
      start: 1,
      end: 5,
      commit: {
        sha: commit.oid,
        message: commit.message,
        author: 'Sample Author',
        login: undefined,
        avatar: commit.author.avatarUrl,
        date: commit.committedDate,
      },
    })
    expect(rangeAt(ranges, 5)).toBe(ranges[0])
    expect(rangeAt(ranges, 6)).toBe(ranges[1])
    expect(rangeAt(ranges, 9)).toBeNull()
  })
  it('shares in-flight reads per client/repository/ref/path but not across credentials', async () => {
    const c = client()
    await Promise.all([loadBlame(c, file), loadBlame(c, file)])
    expect(c.graphql).toHaveBeenCalledTimes(1)
    await loadBlame(c, { ...file, ref: 'other' })
    await loadBlame(c, { ...file, path: 'other.ts' })
    await loadBlame(c, { ...file, repo: 'other-repo' })
    expect(c.graphql).toHaveBeenCalledTimes(4)
    const other = client()
    await loadBlame(other, file)
    expect(other.graphql).toHaveBeenCalledTimes(1)
  })
  it('preserves client errors and retries failures rather than caching them', async () => {
    const c = client()
    const error = new GithubError('auth', 'Sample refusal')
    vi.mocked(c.graphql).mockRejectedValueOnce(error)
    await expect(loadBlame(c, file)).rejects.toBe(error)
    await expect(loadBlame(c, file)).resolves.toHaveLength(2)
  })
  it('reports a missing commit rather than showing an empty attribution', async () => {
    const c = client()
    vi.mocked(c.graphql).mockResolvedValueOnce({ repository: { object: null } })
    await expect(loadBlame(c, file)).rejects.toMatchObject({ kind: 'not-found' })
  })
})
