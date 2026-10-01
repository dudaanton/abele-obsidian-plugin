import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGithubTools } from '@/ai/tools/github'
import { AbeleConfig } from '@/services/AbeleConfig'
import { githubSettingsFrom } from '@/github/settings'
import { useVault } from '../helpers/testEnv'

const request = vi.hoisted(() => vi.fn())
vi.mock('@/github/transport', () => ({ singleHopRequest: request }))

let actor: { id: string; githubConnections: Record<string, 'auto' | 'ask' | 'off'> }
const params = {
  connection: 'Sample Enterprise',
  repo: 'sample-org/sample-repo',
  ref: 'topic/sample',
  path: 'sample.ts',
  blame: true,
}
const commit = {
  oid: 'a'.repeat(40),
  message: 'Sample attribution',
  committedDate: '2025-01-02T12:00:00Z',
  author: { name: 'Sample Author' },
}
const blame = {
  data: {
    repository: { object: { blame: { ranges: [{ startingLine: 1, endingLine: 4, commit }] } } },
  },
}
const reply = (json: unknown) => ({
  status: 200,
  headers: {},
  text: JSON.stringify(json),
  json,
  arrayBuffer: new ArrayBuffer(0),
})
const tool = (approve?: () => Promise<boolean>) =>
  createGithubTools({ agent: () => actor, approve }).find((t) => t.name === 'github_file')!

beforeEach(() => {
  const app = useVault([])
  AbeleConfig.getInstance().github = githubSettingsFrom({
    enabled: true,
    connections: [
      {
        id: 'sample-public',
        name: 'Sample Public',
        server: '',
        keyId: 'sample-public-key',
        owners: [],
        isDefault: true,
      },
      {
        id: 'sample-enterprise',
        name: 'Sample Enterprise',
        server: 'https://git.example.test',
        keyId: 'sample-enterprise-key',
        owners: [],
        isDefault: true,
      },
    ],
  })
  app.secretStorage.setSecret('sample-public-key', 'invented-public')
  app.secretStorage.setSecret('sample-enterprise-key', 'invented-enterprise')
  actor = {
    id: 'sample-agent',
    githubConnections: { 'sample-public': 'auto', 'sample-enterprise': 'auto' },
  }
  request
    .mockReset()
    .mockImplementation(async (r) => reply(r.method === 'POST' ? blame : { type: 'file' }))
})

describe('blame connection access', () => {
  it('uses the selected Enterprise connection for both the file and GraphQL blame', async () => {
    const result = await tool().execute('sample-call', params)
    expect(JSON.stringify(result)).toContain('Sample attribution')
    expect(JSON.stringify(result)).toContain('GitHub connection: Sample Enterprise')
    expect(request).toHaveBeenCalledTimes(2)
    for (const [r] of request.mock.calls) {
      expect(new URL(r.url).origin).toBe('https://git.example.test')
      expect(r.headers.Authorization).toBe('Bearer invented-enterprise')
    }
    expect(JSON.parse(request.mock.calls[1][0].body).variables).toEqual({
      owner: params.repo.split('/')[0],
      repo: params.repo.split('/')[1],
      ref: params.ref,
      path: params.path,
    })
  })
  it('Off blocks blame without asking or reaching the transport', async () => {
    actor.githubConnections['sample-enterprise'] = 'off'
    const approve = vi.fn(async () => true)
    await expect(tool(approve).execute('sample-call', params)).rejects.toThrow(/disabled|access/i)
    expect(approve).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
  })
  it('Ask refusal blocks blame before the file request', async () => {
    actor.githubConnections['sample-enterprise'] = 'ask'
    const approve = vi.fn(async () => false)
    await expect(tool(approve).execute('sample-call', params)).rejects.toThrow(/not approved/i)
    expect(approve).toHaveBeenCalledOnce()
    expect(request).not.toHaveBeenCalled()
  })
  it('Ask approval covers file and blame once per call, then Off blocks a warmed result', async () => {
    actor.githubConnections['sample-enterprise'] = 'ask'
    const approve = vi.fn(async () => true)
    const t = tool(approve)
    expect(JSON.stringify(await t.execute('sample-call', params))).toContain('Sample attribution')
    expect(approve).toHaveBeenCalledOnce()
    const count = request.mock.calls.length
    actor.githubConnections['sample-enterprise'] = 'off'
    await expect(t.execute('sample-next', params)).rejects.toThrow(/disabled|access/i)
    expect(request).toHaveBeenCalledTimes(count)
  })
  it('rejects a revocation during GraphQL rather than publishing the answer', async () => {
    request.mockImplementation(async (r) => {
      if (r.method === 'POST') actor.githubConnections['sample-enterprise'] = 'off'
      return reply(r.method === 'POST' ? blame : { type: 'file' })
    })
    await expect(tool().execute('sample-call', params)).rejects.toThrow(/revoked|access/i)
  })
})
