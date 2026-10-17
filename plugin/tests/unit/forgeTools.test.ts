import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createForgeTools, createGithubTools } from '@/ai/tools/github'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { nativeSourceForTab } from '@/github/tabConnectionAccess'
import { tarball } from '../e2e/helpers/fakeGithubRepo'
import * as service from '@/github/GithubService'
import { emptyScreen } from '@/github/screen'
import { usesNativeTool } from '@/ai/tools/github/nativeTools'
const request = vi.hoisted(() => vi.fn())
vi.mock('@/github/transport', () => ({ singleHopRequest: request }))
let mode: 'auto' | 'off' | 'ask' = 'auto'
const actor = () => ({ id: 'sample-agent', githubConnections: { sample: mode } })
beforeEach(() => {
  useVault([])
  mode = 'auto'
  AbeleConfig.getInstance().github = githubSettingsFrom({
    enabled: true,
    connections: [
      {
        id: 'sample',
        provider: 'gitea',
        name: 'Sample service',
        server: 'https://git.example.test/team',
        keyId: '',
        owners: [],
        isDefault: true,
      },
    ],
  })
  request.mockReset().mockImplementation(async ({ url }) => ({
    status: 200,
    headers: {},
    text: '',
    arrayBuffer: new ArrayBuffer(0),
    json: url.includes('/contents/')
      ? { type: 'file', encoding: 'base64', content: btoa('first\nsecond\nthird\n') }
      : { sha: 'a'.repeat(40) },
  }))
})
describe('neutral forge tools and compatibility aliases', () => {
  it('keeps explicit GitHub URLs and unsupported provider choices out of native shorthand routing', () => {
    expect(usesNativeTool({ url: 'https://github.com/sample/project/issues/1' })).toBe(false)
    expect(usesNativeTool({ repo: 'sample/project' })).toBe(true)
    AbeleConfig.getInstance().github.connections.push({
      id: 'future',
      name: 'Sample future service',
      provider: 'gitlab',
      server: 'https://future.example.test',
      keyId: '',
      owners: [],
      isDefault: true,
    })
    expect(usesNativeTool({ connection: 'future', repo: 'sample/project' })).toBe(false)
  })
  it('revokes an inventory result assembled just before connection access changes', async () => {
    const app = useVault([])
    Object.assign(app, {
      workspace: {
        getLeavesOfType: () => [
          {
            view: {
              model: {
                connectionId: 'sample',
                target: service.parseForSettings('https://git.example.test/team/sample/project'),
                screen: { ...emptyScreen(), title: 'Sample private title' },
              },
            },
          },
        ],
      },
    })
    const pending = createForgeTools({ agent: actor })
      .find((t) => t.name === 'forge_views')!
      .execute('sample', {})
    mode = 'off'
    await expect(pending).rejects.toThrow(/revoked|changed/i)
  })
  it('requires an explicit connection for an ambiguous native shorthand', async () => {
    AbeleConfig.getInstance().github.connections.push({
      id: 'other',
      provider: 'forgejo',
      name: 'Other sample',
      server: 'https://other.example.test',
      keyId: '',
      owners: [],
      isDefault: true,
    })
    const tool = createForgeTools({
      agent: () => ({ id: 'sample', githubConnections: { sample: 'auto', other: 'auto' } }),
    }).find((t) => t.name === 'forge_file')!
    await expect(
      tool.execute('sample', { repo: 'sample/project', path: 'sample.ts' })
    ).rejects.toThrow(/ambiguous|choose a connection/i)
    expect(request).not.toHaveBeenCalled()
  })
  it('executes all eight native capabilities and keeps grep at one resolved revision', async () => {
    const sha = 'a'.repeat(40),
      archive = tarball({ 'sample.ts': 'export const sample = 1\n' }, 'sample-project')
    let resolutions = 0
    request.mockImplementation(async ({ url }) => {
      let json: unknown = []
      if (url.includes('/commits/main')) json = { sha: ++resolutions === 1 ? sha : 'b'.repeat(40) }
      else if (url.includes('/git/trees/'))
        json = {
          tree: [
            { path: 'sample.ts', type: 'blob', mode: '100644', sha: 'c'.repeat(40), size: 24 },
          ],
        }
      else if (/\/git\/commits\//.test(url))
        json = {
          sha,
          commit: { message: 'Sample commit', author: { name: 'Sample', date: '' } },
          files: [],
        }
      else if (/\/issues\/12$/.test(url))
        json = { number: 12, title: 'Sample issue', body: 'Sample body', state: 'open' }
      else if (/\/issues\?/.test(url)) json = [{ number: 12, title: 'Sample issue', state: 'open' }]
      else if (/\/pulls\?/.test(url)) json = [{ number: 14, title: 'Sample change', state: 'open' }]
      else if (/\/contents\//.test(url))
        json = { type: 'file', encoding: 'base64', content: btoa('sample\n') }
      return {
        status: 200,
        headers: {},
        json,
        text: '',
        arrayBuffer: Uint8Array.from(archive).buffer,
      }
    })
    const open = vi.spyOn(service, 'openGithubUrl').mockResolvedValue(true)
    try {
      const tools = createForgeTools({ agent: actor })
      const call = (name: string, params: Record<string, unknown>) =>
        tools
          .find((tool) => tool.name === name)!
          .execute('sample-call', { connection: 'sample', ...params })
      expect(JSON.stringify(await call('forge_views', {}))).toContain('gitea')
      expect(JSON.stringify(await call('forge_read', { item: 'sample/project#12' }))).toContain(
        'Sample body'
      )
      await call('forge_pr_files', { item: 'sample/project#12' })
      await call('forge_file', { repo: 'sample/project', path: 'sample.ts', ref: sha })
      expect(
        JSON.stringify(await call('forge_commits', { repo: 'sample/project', sha }))
      ).toContain('Sample commit')
      expect(
        JSON.stringify(
          await call('forge_search', { repo: 'sample/project', type: 'issues', query: 'Sample' })
        )
      ).toContain('Sample issue')
      expect(
        JSON.stringify(
          await call('forge_search', { repo: 'sample/project', type: 'issues', query: 'Sample' })
        )
      ).toContain('Sample change')
      expect(
        JSON.stringify(
          await call('forge_grep', { repo: 'sample/project', ref: 'main', query: 'sample' })
        )
      ).toContain(sha)
      expect(resolutions).toBe(1)
      await call('forge_open', { url: 'https://git.example.test/team/sample/project/issues/12' })
      expect(open).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        false,
        expect.objectContaining({
          connectionId: 'sample',
          agentId: 'sample-agent',
          allowedIds: ['sample'],
        })
      )
    } finally {
      open.mockRestore()
    }
  })
  it('keeps an agent-opened native tab bound to its captured permission scope', async () => {
    const lookup = vi
      .spyOn(AgentRegistry.getInstance(), 'get')
      .mockImplementation(() => actor() as never)
    try {
      const source = nativeSourceForTab(
        {
          allowedConnections: ['sample'],
          executionAgentId: 'sample-agent',
          approvedConnections: {},
        },
        'sample',
        'sample/project'
      )
      expect(await source.resolve('main')).toBe('a'.repeat(40))
      mode = 'off'
      await expect(source.resolve('main')).rejects.toThrow(/access|revoked/i)
    } finally {
      lookup.mockRestore()
    }
  })
  it.each(['forge_open', 'github_open'])(
    '%s does not grant Ask approval to secondary reads opened under Auto',
    async (name) => {
      const lookup = vi
        .spyOn(AgentRegistry.getInstance(), 'get')
        .mockImplementation(() => actor() as never)
      const open = vi.spyOn(service, 'openGithubUrl').mockResolvedValue(true)
      const approve = vi.fn(async () => true)
      try {
        const tool = [
          ...createForgeTools({ agent: actor, approve }),
          ...createGithubTools({ agent: actor, approve }),
        ].find((t) => t.name === name)!
        await tool.execute('sample-open', {
          connection: 'sample',
          url: 'https://git.example.test/team/sample/project',
        })
        expect(approve).not.toHaveBeenCalled()
        const options = open.mock.calls[0][3]!
        const source = nativeSourceForTab(
          {
            allowedConnections: options.allowedIds,
            executionAgentId: options.agentId,
            approvedConnections: options.approvedConnections,
          },
          'sample',
          'sample/project'
        )
        request.mockImplementationOnce(async () => {
          mode = 'ask'
          return {
            status: 200,
            headers: {},
            json: { sha: 'b'.repeat(40) },
            text: '',
            arrayBuffer: new ArrayBuffer(0),
          }
        })
        await expect(source.resolve('secondary-auto')).rejects.toThrow(/access|approval|revoked/i)
      } finally {
        lookup.mockRestore()
        open.mockRestore()
      }
    }
  )
  it.each(['forge_open', 'github_open'])(
    '%s retains an actual Ask approval for secondary reads',
    async (name) => {
      mode = 'ask'
      const lookup = vi
        .spyOn(AgentRegistry.getInstance(), 'get')
        .mockImplementation(() => actor() as never)
      const open = vi.spyOn(service, 'openGithubUrl').mockResolvedValue(true)
      const approve = vi.fn(async () => true)
      try {
        const tool = [
          ...createForgeTools({ agent: actor, approve }),
          ...createGithubTools({ agent: actor, approve }),
        ].find((t) => t.name === name)!
        await tool.execute('sample-open', {
          connection: 'sample',
          url: 'https://git.example.test/team/sample/project',
        })
        expect(approve).toHaveBeenCalledOnce()
        const options = open.mock.calls[0][3]!
        const source = nativeSourceForTab(
          {
            allowedConnections: options.allowedIds,
            executionAgentId: options.agentId,
            approvedConnections: options.approvedConnections,
          },
          'sample',
          'sample/project'
        )
        expect(await source.resolve('secondary-approved')).toBe('a'.repeat(40))
      } finally {
        lookup.mockRestore()
        open.mockRestore()
      }
    }
  )
  it('registers eight neutral names without inheriting alias permission modes', () => {
    const tools = createForgeTools({ agent: actor })
    expect(tools.map((tool) => tool.name)).toEqual([
      'forge_views',
      'forge_read',
      'forge_pr_files',
      'forge_file',
      'forge_commits',
      'forge_search',
      'forge_grep',
      'forge_open',
    ])
    const agent = { toolModes: { github_file: 'auto' }, maxDelegateDepth: 0 } as never
    expect(AgentRegistry.getInstance().filterTools(agent, tools)).toEqual([])
  })
  it.each(['forge_file', 'github_file'])(
    'enforces per-connection Off/Ask/Auto for %s',
    async (name) => {
      const approve = vi.fn(async () => true)
      const tool = [
        ...createForgeTools({ agent: actor, approve }),
        ...createGithubTools({ agent: actor, approve }),
      ].find((tool) => tool.name === name)!
      const input = {
        repo: 'sample/project',
        path: 'sample.ts',
        ref: 'main',
        connection: 'sample',
        start_line: 2,
        end_line: 2,
      }
      mode = 'off'
      await expect(tool.execute('sample-call', input)).rejects.toThrow(/disabled|revoked/i)
      expect(request).not.toHaveBeenCalled()
      mode = 'ask'
      const result = await tool.execute('sample-call', input)
      expect(approve).toHaveBeenCalledOnce()
      expect(JSON.stringify(result)).toContain('second')
      expect(JSON.stringify(result)).not.toContain('third')
      mode = 'auto'
      await tool.execute('sample-call', input)
      expect(approve).toHaveBeenCalledOnce()
    }
  )
  it('rejects a late native read after its delegated connection ceiling is revoked', async () => {
    request.mockImplementation(async () => {
      mode = 'off'
      return {
        status: 200,
        headers: {},
        json: { sha: 'a'.repeat(40) },
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      }
    })
    const tool = createForgeTools({ agent: actor }).find((tool) => tool.name === 'forge_file')!
    await expect(
      tool.execute('sample-call', {
        repo: 'sample/project',
        path: 'sample.ts',
        connection: 'sample',
      })
    ).rejects.toThrow(/revoked|disabled/)
  })
  it('does not turn a changed Auto permission into an implicit Ask grant', async () => {
    request.mockImplementation(async () => {
      mode = 'ask'
      return {
        status: 200,
        headers: {},
        json: { sha: 'a'.repeat(40) },
        text: '',
        arrayBuffer: new ArrayBuffer(0),
      }
    })
    const tool = createForgeTools({ agent: actor }).find((tool) => tool.name === 'forge_file')!
    await expect(
      tool.execute('sample-call', {
        repo: 'sample/project',
        path: 'sample.ts',
        connection: 'sample',
      })
    ).rejects.toThrow(/revoked|approval/)
  })
})
