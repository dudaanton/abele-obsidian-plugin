import { describe, expect, it, vi } from 'vitest'
import { nativeAccountRepos, nativeOpenRows, nativeSearchRepos } from '@/forge/forgejoDirectory'
import { ForgejoClient } from '@/forge/forgejoClient'
import { deployment } from '@/forge/identity'

describe('native repository discovery', () => {
  it('uses wrapped search and native own/starred APIs with deployment-aware identities', async () => {
    const repo = { name: 'project', owner: { login: 'sample' }, stars_count: 3 }
    const http = vi.fn(async ({ url }: { url: string }) => ({
      status: 200,
      headers: {},
      text: '',
      arrayBuffer: new ArrayBuffer(0),
      json: url.includes('/repos/search') ? { data: [repo] } : [repo],
    }))
    const client = new ForgejoClient(
      deployment('gitea', 'https://git.example.test/team'),
      { connectionId: 'sample', generation: 'one', assertCurrent() {} },
      http,
      ''
    )
    expect(await nativeSearchRepos(client, 'project')).toMatchObject([
      {
        provider: 'gitea',
        origin: 'https://git.example.test/team',
        owner: 'sample',
        repo: 'project',
        stars: 3,
      },
    ])
    expect(await nativeAccountRepos(client)).toMatchObject({
      own: [{ repo: 'project' }],
      starred: [{ repo: 'project' }],
    })
    expect(http.mock.calls.map(([r]) => r.url)).toContain(
      'https://git.example.test/team/api/v1/user/starred?limit=50&page=1'
    )
  })
  it('resolves a native short issue number without a GitHub search request', async () => {
    const http = vi.fn(async () => ({
      status: 200,
      headers: {},
      text: '',
      arrayBuffer: new ArrayBuffer(0),
      json: { number: 12, title: 'Sample change', pull_request: {} },
    }))
    const client = new ForgejoClient(
      deployment('forgejo', 'https://git.example.test/team'),
      { connectionId: 'sample', generation: 'one', assertCurrent() {} },
      http,
      ''
    )
    expect(await nativeOpenRows(client, 'sample/project', '#12')).toMatchObject([
      { kind: 'pull', url: 'https://git.example.test/team/sample/project/pulls/12' },
    ])
  })
})
