import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGithubTools } from '@/ai/tools/github'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { useVault } from '../helpers/testEnv'
import { GlobalStore } from '@/stores/GlobalStore'
import { emptyScreen } from '@/github/screen'
import { connectionClient } from '@/github/GithubService'
import { indexes } from '@/github/search/source'
import { RepoIndex, indexKey } from '@/github/search/repoIndex'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/github/transport', () => ({ singleHopRequest: request }))
let actor = {
  id: 'sample-agent',
  githubConnections: {
    public: 'auto' as 'auto' | 'off' | 'ask',
    enterprise: 'off' as 'auto' | 'off' | 'ask',
  },
}
beforeEach(() => {
  const app = useVault([])
  AbeleConfig.getInstance().github = githubSettingsFrom({
    enabled: true,
    connections: [
      {
        id: 'public',
        name: 'Personal',
        server: '',
        keyId: 'public-key',
        owners: [],
        isDefault: true,
        account: { login: 'sample-public' },
      },
      {
        id: 'enterprise',
        name: 'Enterprise',
        server: 'https://git.example.test',
        keyId: 'enterprise-key',
        owners: [],
        isDefault: true,
        account: { login: 'sample-enterprise' },
      },
    ],
  })
  app.secretStorage.setSecret('public-key', 'invented-public')
  app.secretStorage.setSecret('enterprise-key', 'invented-enterprise')
  actor = { id: 'sample-agent', githubConnections: { public: 'auto', enterprise: 'off' } }
  request
    .mockReset()
    .mockResolvedValue({
      status: 200,
      headers: {},
      json: { items: [] },
      text: 'sample code',
      arrayBuffer: new ArrayBuffer(0),
    })
})
const tools = (approve?: () => Promise<boolean>) =>
  createGithubTools({ agent: () => actor, approve })
const run = (name: string, params: Record<string, unknown>) =>
  tools()
    .find((t) => t.name === name)!
    .execute('sample-call', params)

describe('GitHub tool connection contracts', () => {
  it('adds the optional parameter to all eight schemas', () => {
    const list = tools()
    expect(list).toHaveLength(8)
    for (const tool of list) expect(tool.parameters.properties).toHaveProperty('connection')
  })
  it.each([
    'github_read',
    'github_pr_files',
    'github_file',
    'github_commits',
    'github_search',
    'github_grep',
    'github_open',
  ])('%s refuses explicit Off before network or cached content', async (name) => {
    await expect(
      run(name, {
        connection: 'Enterprise',
        repo: 'sample/project',
        item: 'sample/project#1',
        url: 'sample/project#1',
        query: 'sample',
        type: 'code',
      })
    ).rejects.toThrow(/disabled|access/i)
    expect(request).not.toHaveBeenCalled()
  })
  it('resolves explicit Enterprise before parsing shorthand', async () => {
    actor.githubConnections.enterprise = 'auto'
    await run('github_search', {
      connection: 'Enterprise',
      repo: 'sample/project',
      query: 'needle',
      type: 'code',
    })
    expect(request.mock.calls[0][0]).toMatchObject({
      url: expect.stringContaining('https://git.example.test/api/v3/search/code'),
      headers: { Authorization: 'Bearer invented-enterprise' },
    })
  })
  it('refuses a URL from another server, and an ambiguous connection name', async () => {
    await expect(
      run('github_file', {
        connection: 'Personal',
        repo: 'https://git.example.test/sample/project/blob/main/file.ts',
      })
    ).rejects.toThrow(/server/i)
    AbeleConfig.getInstance().github.connections[1].name = 'Personal'
    await expect(
      run('github_file', { connection: 'Personal', repo: 'sample/project' })
    ).rejects.toThrow(/ambiguous/i)
    expect(request).not.toHaveBeenCalled()
  })
  it('Ask uses the supplied execution approval once, but cannot override a revoked permission', async () => {
    actor.githubConnections.public = 'ask'
    const approve = vi.fn(async () => {
      actor.githubConnections.public = 'off'
      return true
    })
    await expect(
      tools(approve)
        .find((t) => t.name === 'github_search')!
        .execute('id', { query: 'sample', type: 'issues' })
    ).rejects.toThrow(/access|disabled/i)
    expect(approve).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })
  it('never returns disallowed tab titles, URLs, errors, code or prose through views', async () => {
    const app = GlobalStore.getInstance().app
    Object.assign(app, {
      workspace: {
        getLeavesOfType: () => [
          {
            view: {
              model: {
                url: 'https://git.example.test/private/repo',
                connectionId: 'enterprise',
                target: { kind: 'repo', host: 'git.example.test', owner: 'private', repo: 'repo' },
                screen: {
                  ...emptyScreen(),
                  title: 'Restricted title',
                  error: 'Private error',
                  selection: { code: 'Private code' },
                  prose: { text: 'Private prose' },
                },
              },
            },
          },
        ],
      },
    })
    const output = JSON.stringify(await run('github_views', {}))
    expect(output).toContain('Restricted GitHub tab')
    for (const text of [
      'Restricted title',
      'Private error',
      'Private code',
      'Private prose',
      '/private/repo',
    ])
      expect(output).not.toContain(text)
  })

  it('refuses a warmed repository index after connection access is turned Off', async () => {
    const client=connectionClient('public'), sha='a'.repeat(40)
    const index=new RepoIndex()
    index.add('private.ts','private cached content')
    indexes.set(`${client.cacheNamespace}:${indexKey('github.com','sample','project',sha)}`,index)
    actor.githubConnections.public='off'
    await expect(run('github_grep',{repo:'sample/project',connection:'Personal',ref:sha,query:'private'})).rejects.toThrow(/access|disabled/i)
    expect(request).not.toHaveBeenCalled()
    indexes.clear()
  })

  it('rechecks permission before a delayed response becomes tool output', async () => {
    let finish!: (value: unknown) => void
    request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = run('github_search', { query: 'sample', type: 'issues' })
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce())
    actor.githubConnections.public = 'off'
    finish({
      status: 200,
      headers: {},
      json: { items: [] },
      text: '',
      arrayBuffer: new ArrayBuffer(0),
    })
    await expect(pending).rejects.toThrow(/revoked|access/i)
  })

  it('refuses an endpoint or token replacement while its connection approval is pending', async () => {
    actor.githubConnections.public='ask'
    const approve=vi.fn(async()=>{
      AbeleConfig.getInstance().github.connections[0].server='https://changed.example.test'
      return true
    })
    await expect(tools(approve).find(t=>t.name==='github_search')!.execute('change',{query:'sample',type:'issues'})).rejects.toThrow(/connection changed/i)
    expect(request).not.toHaveBeenCalled()
  })

  it('views lists safe account metadata even without tabs and never key slots or tokens', async () => {
    const r = await run('github_views', {})
    const out = JSON.stringify(r)
    expect(out).toContain('Personal')
    expect(out).toContain('sample-public')
    expect(out).toContain('Enterprise')
    expect(out).not.toContain('public-key')
    expect(out).not.toContain('enterprise-key')
    expect(out).not.toContain('invented-')
  })
})
