import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { toolOperation } from '@/ai/tools/github/operation'
import { applyEntries, collectEntries } from '@/transfer/entries'
import { DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { preferredConnection } from '@/github/connections'
import { notificationsClient, resetGithubClients } from '@/github/GithubService'
import { githubForge } from '@/node/nodePathForge'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/github/transport', () => ({ singleHopRequest: request }))
const github = {
  id: 'github',
  name: 'Sample GitHub',
  server: '',
  keyId: 'github-slot',
  owners: [],
  isDefault: true,
}
const foreign = {
  ...github,
  id: 'foreign',
  provider: 'forgejo',
  name: 'Sample Forgejo',
  server: 'https://github.com',
  keyId: 'foreign-slot',
  checkState: 'partial' as const,
}
const actor = {
  id: 'sample-agent',
  githubConnections: { github: 'auto' as const, foreign: 'auto' as const },
}
beforeEach(() => {
  useVault([])
  resetGithubClients()
  AbeleConfig.getInstance().github = githubSettingsFrom({
    enabled: true,
    connections: [foreign, github],
  })
  request.mockReset()
})

describe('unavailable provider consumers', () => {
  it('does not treat a node remote on an unavailable configured host as public GitHub', async () => {
    AbeleConfig.getInstance().github = githubSettingsFrom({
      connections: [{ ...foreign, server: 'https://git.example.test/team' }],
    })
    const repo = {
      kind: 'github' as const,
      host: 'git.example.test',
      owner: 'sample',
      name: 'project',
    }
    expect(await githubForge.pulls(repo)).toEqual({ connected: false, pulls: [] })
    await expect(
      githubForge.create(repo, {
        title: 'Sample change',
        body: '',
        base: 'main',
        head: 'sample',
        draft: false,
      })
    ).rejects.toThrow(/available in a later version/i)
    expect(request).not.toHaveBeenCalled()
  })
  it('refuses explicit tool selection before approval or secret lookup', async () => {
    const app = useVault([])
    const read = vi.spyOn(app.secretStorage, 'getSecret')
    const approve = vi.fn(async () => true)
    await expect(
      toolOperation(
        'github_file',
        { connection: 'foreign', repo: 'sample/project' },
        { agent: () => actor, approve }
      )
    ).rejects.toThrow(/available in a later version/i)
    expect(read.mock.calls.some(([id]) => id === foreign.keyId)).toBe(false)
    expect(approve).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })
  it('does not advertise unsupported connections as permitted GitHub accounts', async () => {
    const operation = await toolOperation('github_views', {}, { agent: () => actor })
    expect(operation.allowedIds).toEqual(['github'])
    expect(operation.canReadTab('foreign')).toBe(false)
    expect(operation.inventory).toMatch(/Forgejo.*available in a later version/i)
  })
  it('preserves provider connections and secret references in the transfer preview', () => {
    const settings = { ...DEFAULT_SETTINGS, github: AbeleConfig.getInstance().github }
    const entry = collectEntries(settings).find(
      (entry) => entry.section === 'github-connections' && entry.id === 'foreign'
    )!
    expect(entry.label).toContain('Forgejo')
    expect(entry.label).not.toMatch(/available in a later version/i)
    expect(entry.secretIds).toEqual(['foreign-slot'])
    expect(entry.data).toMatchObject(foreign)
    const restored = applyEntries([entry], {
      ...settings,
      github: { ...settings.github, connections: [] },
    })
    expect(restored.github.connections).toContainEqual(expect.objectContaining(foreign))
  })
  it('uses only the supported default for pickers and the retained inbox', () => {
    const settings = AbeleConfig.getInstance().github
    expect(preferredConnection(settings.connections)?.id).toBe('github')
    expect(notificationsClient().client.endpoints.origin).toBe('https://github.com')
  })
  it('never opens GitHub requests for an unsupported node remote', async () => {
    const repo = {
      kind: 'other' as const,
      host: 'git.example.test',
      owner: 'sample',
      name: 'project',
    }
    expect(await githubForge.pulls(repo)).toEqual({ connected: false, pulls: [] })
    await expect(
      githubForge.create(repo, {
        title: 'Sample change',
        body: '',
        base: 'main',
        head: 'sample',
        draft: false,
      })
    ).rejects.toThrow('GitHub only')
    expect(request).not.toHaveBeenCalled()
  })
})
