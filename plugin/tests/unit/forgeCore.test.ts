import { describe, expect, it, vi } from 'vitest'
import { deployment, deploymentKey, authorityKey } from '@/forge/identity'
import { withoutCredentials, checkedRead } from '@/forge/transport'
import { githubProvider } from '@/forge/github'
import { clientWith } from '../helpers/githubTab'
import { githubRepositorySource } from '@/repository/github'
import { sourceKey } from '@/repository/source'
import { savedForgeTarget } from '@/repository/state'
import { guardedGithubClient } from '@/github/guardedClient'

describe('forge authority boundary', () => {
  it('constructs view adapters after revocation so the async load can publish its refusal', async () => {
    const { client, request } = clientWith({})
    const guarded = guardedGithubClient(
      client,
      () => {
        throw new Error('Connection approval expired')
      },
      true
    )
    let source: ReturnType<typeof githubRepositorySource> | undefined
    expect(() => {
      source = githubRepositorySource(
        guarded,
        { host: 'github.com', owner: 'sample', repo: 'project' },
        'sample-account'
      )
    }).not.toThrow()
    await expect(
      source!.github!.loadTarget(
        { host: 'github.com', owner: 'sample', repo: 'project', kind: 'issue', number: 7 },
        () => {}
      )
    ).rejects.toThrow('Connection approval expired')
    expect(request).not.toHaveBeenCalled()
  })
  it('keys non-GitHub sources by full deployment and restores versioned targets safely', () => {
    const one = {
      provider: 'gitlab' as const,
      connection: 'sample-account',
      deployment: deployment('gitlab', 'https://git.example.test/team'),
      repository: 'group/subgroup/project',
    }
    const two = { ...one, deployment: deployment('gitlab', 'https://git.example.test/other') }
    expect(sourceKey(one)).not.toBe(sourceKey(two))
    const target = {
      version: 1,
      ...one,
      url: 'https://git.example.test/team/group/subgroup/project/-/issues/7',
    }
    expect(savedForgeTarget({ sourceTarget: target })).toEqual(target)
    expect(savedForgeTarget({ sourceTarget: { ...target, version: 2 } })).toBeNull()
    expect(savedForgeTarget({ sourceTarget: { ...target, provider: 'future-forge' } })).toBeNull()
    expect(
      savedForgeTarget({
        sourceTarget: {
          ...target,
          url: 'https://git.example.test/team-other/group/subgroup/project',
        },
      })
    ).toBeNull()
    expect(
      savedForgeTarget({
        sourceTarget: {
          ...target,
          deployment: { ...one.deployment, apiBase: 'https://elsewhere.example.test/api/v4' },
        },
      })
    ).toBeNull()
  })
  it('retains the explicit web identity supplied to the legacy repository facade', () => {
    const source = githubRepositorySource(
      clientWith({}).client,
      {
        host: 'git.example.test',
        origin: 'http://git.example.test:8080',
        owner: 'sample',
        repo: 'project',
      },
      'sample-account'
    )
    expect(source.identity).toMatchObject({
      server: 'http://git.example.test:8080',
      connection: 'sample-account',
    })
    expect(source.navigation.home()).toBe('http://git.example.test:8080/sample/project')
  })
  it('wraps the existing GitHub source without changing navigation or authority', async () => {
    const { client } = clientWith({
      '/repos/sample/project/contents/src/app.ts': { text: 'sample text' },
    })
    const provider = githubProvider(client, 'sample-account')
    const parsed = provider.urls.parse(
      'https://github.com/sample/project/blob/topic/work/src/app.ts'
    )
    expect(parsed).toMatchObject({ owner: 'sample', repo: 'project', kind: 'blob' })
    expect(provider.urls.parse('https://github.com:8443/sample/project')).toBeNull()
    expect(provider.urls.parse('https://user:pass@github.com/sample/project')).toBeNull()
    const source = provider.repository({
      deployment: provider.deployment,
      fullPath: 'sample/project',
    })
    expect(source.identity).toMatchObject({ provider: 'github', connection: 'sample-account' })
    expect(await source.blob('topic/work', 'src/app.ts')).toMatchObject({ text: 'sample text' })
    expect(source.navigation.file('a'.repeat(40), 'README.md', 3)).toContain('?plain=1#L3')
    expect(() =>
      provider.repository({
        deployment: deployment('gitlab', 'https://github.com'),
        fullPath: 'sample/project',
      })
    ).toThrow(/deployment/)
    client.retire()
    expect(() =>
      provider.repository({ deployment: provider.deployment, fullPath: 'sample/project' })
    ).toThrow(/connection changed/)
  })
  it('keeps provider, scheme, port and deployment path in identity', () => {
    const base = deployment('forgejo', 'http://git.example.test:8080/team/')
    expect(base).toEqual({
      kind: 'forgejo',
      webBase: 'http://git.example.test:8080/team',
      apiBase: 'http://git.example.test:8080/team/api/v1',
    })
    expect(
      new Set([
        deploymentKey(base),
        deploymentKey(deployment('gitea', base.webBase)),
        deploymentKey(deployment('forgejo', 'http://git.example.test:8080/other')),
        deploymentKey(deployment('forgejo', 'https://git.example.test:8080/team')),
      ]).size
    ).toBe(4)
    expect(authorityKey(base, 'a', 'g1', 'group/repo', 'abc')).not.toBe(
      authorityKey(base, 'a', 'g2', 'group/repo', 'abc')
    )
    expect(authorityKey(base, 'a', 'g1', 'group/repo', 'abc')).not.toBe(
      authorityKey(base, 'b', 'g1', 'group/repo', 'abc')
    )
  })
  it('rejects credentials, queries, fragments and traversal before URL normalization', () => {
    for (const address of [
      'https://user:password@git.example.test',
      'https://git.example.test/?key=x',
      'https://git.example.test/#x',
      'https://git.example.test/a/../b',
      'https://git.example.test/a/%2e%2e/b',
      'ftp://git.example.test',
    ])
      expect(() => deployment('gitlab', address)).toThrow()
    expect(deployment('gitlab', 'git.example.test/groups').apiBase).toBe(
      'https://git.example.test/groups/api/v4'
    )
  })
  it('strips every credential header variant on an unapproved hop', () => {
    expect(
      withoutCredentials({
        Authorization: 'secret',
        'PRIVATE-TOKEN': 'secret',
        'Job-Token': 'secret',
        'Deploy-Token': 'secret',
        Cookie: 'secret',
        'Proxy-Authorization': 'secret',
        'If-None-Match': 'private-tag',
        Accept: 'application/json',
      })
    ).toEqual({ Accept: 'application/json' })
  })
  it('rejects a result whose authority retired while the read was pending', async () => {
    let current = true
    const session = {
      connectionId: 'a',
      generation: 'g1',
      assertCurrent: () => {
        if (!current) throw new Error('retired')
      },
    }
    await expect(
      checkedRead(session, async () => {
        current = false
        return 'private'
      })
    ).rejects.toThrow('retired')
    const read = vi.fn()
    await expect(checkedRead(session, read)).rejects.toThrow('retired')
    expect(read).not.toHaveBeenCalled()
  })
})
