import { beforeEach, expect, it, vi } from 'vitest'
import { githubForge } from '@/node/nodePathForge'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { useVault } from '../helpers/testEnv'
const reads = vi.hoisted(() => ({
  pages: vi.fn(),
  write: vi.fn(),
  session: { generation: 'sample', assertCurrent() {} },
  deployment: {
    webBase: 'https://git.example.test',
    apiBase: 'https://git.example.test/api/v1',
    kind: 'gitea',
  },
}))
vi.mock('@/forge/forgejoConnections', () => ({ forgejoConnectionClient: () => reads }))
beforeEach(() => {
  useVault([])
  AbeleConfig.getInstance().github = githubSettingsFrom({
    enabled: true,
    connections: [
      {
        id: 'native',
        provider: 'gitea',
        server: 'https://git.example.test',
        keyId: '',
        name: 'Sample',
        owners: [],
        isDefault: true,
      },
    ],
  })
  reads.pages.mockResolvedValue({
    value: [{ number: 4, title: 'Sample', head: { ref: 'topic' } }],
    complete: true,
  })
  reads.write.mockResolvedValue({ number: 5 })
})
it('changes the node PR cache namespace with its native credential generation', () => {
  const repo = {
    kind: 'other' as const,
    host: 'git.example.test',
    owner: 'sample',
    name: 'project',
  }
  const before = githubForge.cacheKey!(repo)
  reads.session.generation = 'next'
  expect(githubForge.cacheKey!(repo)).not.toBe(before)
})
it('preserves a node GitHub binding when the same host also has a native connection', () => {
  AbeleConfig.getInstance().github.connections.push({
    id: 'sample-github',
    name: 'Sample GitHub',
    provider: 'github',
    server: 'https://git.example.test',
    keyId: '',
    owners: [],
    isDefault: true,
  })
  expect(
    githubForge.cacheKey!({
      kind: 'github',
      host: 'git.example.test',
      owner: 'sample',
      name: 'project',
    })
  ).toBe('github:git.example.test')
})
it('routes a root deployment reported by the node to its native provider', async () => {
  const repo = {
    kind: 'other' as const,
    host: 'git.example.test',
    owner: 'sample',
    name: 'project',
  }
  expect(await githubForge.pulls(repo)).toMatchObject({
    connected: true,
    draftSupported: false,
    pulls: [{ number: 4 }],
  })
  expect(
    await githubForge.create(repo, {
      head: 'topic',
      base: 'main',
      title: 'Sample',
      body: '',
      draft: false,
    })
  ).toMatchObject({ number: 5 })
})
it('refuses to guess a deployment path from old node host-only metadata', async () => {
  AbeleConfig.getInstance().github.connections![0].server = 'https://git.example.test/team'
  await expect(
    githubForge.pulls({ kind: 'other', host: 'git.example.test', owner: 'sample', name: 'project' })
  ).rejects.toThrow(/deployment/i)
})
it('explains a missing port instead of routing host-only node metadata to a different deployment', async () => {
  AbeleConfig.getInstance().github.connections![0].server = 'https://git.example.test:8443'
  await expect(
    githubForge.pulls({ kind: 'other', host: 'git.example.test', owner: 'sample', name: 'project' })
  ).rejects.toThrow(/deployment/i)
})
