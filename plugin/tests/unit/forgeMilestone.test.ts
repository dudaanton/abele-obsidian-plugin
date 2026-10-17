import { describe, expect, it, vi } from 'vitest'
import { githubSettingsFrom } from '@/github/settings'
import { routeConnections } from '@/github/connectionRouting'
import { authorizeConnection, connectionMode } from '@/github/agentAccess'
import { collectEntries, applyEntries } from '@/transfer/entries'
import { DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { withoutCredentials } from '@/forge/transport'

const providers = ['github', 'forgejo', 'gitea'] as const
const bases = [
  'https://git.example.test:8443',
  'https://git.example.test:9443',
  'https://git.example.test:8443/team',
  'https://git.example.test:8443/other',
]
const connections = providers.flatMap((provider) =>
  // GitHub Enterprise does not support deployment subpaths.
  (provider === 'github' ? bases.slice(0, 2) : bases).flatMap((server, index) =>
    ['reader', 'reviewer'].map((account) => ({
      id: `${provider}-${index}-${account}`,
      provider,
      server,
      name: 'Sample connection',
      keyId: `${provider}-${index}-${account}-slot`,
      owners: [],
      isDefault: account === 'reader',
      account: { login: `sample-${account}` },
    }))
  )
)

describe('cross-provider milestone matrix', () => {
  it('round-trips simultaneous providers and independent accounts through transfer and restart', () => {
    const settings = { ...DEFAULT_SETTINGS, github: githubSettingsFrom({ connections }) }
    const entries = collectEntries(settings).filter(
      (entry) => entry.section === 'github-connections'
    )
    expect(entries).toHaveLength(connections.length)
    expect(entries.flatMap((entry) => entry.secretIds).sort()).toEqual(
      connections.map((connection) => connection.keyId).sort()
    )
    for (const mode of ['merge', 'replace'] as const) {
      const imported = applyEntries(entries, DEFAULT_SETTINGS, mode)
      expect(githubSettingsFrom(JSON.parse(JSON.stringify(imported.github))).connections).toEqual(
        connections
      )
    }
  })

  for (const connection of connections) {
    it(`isolates routing and explicit accounts for ${connection.id}`, () => {
      const input = {
        provider: connection.provider,
        host: 'git.example.test',
        origin: connection.server,
        owner: 'sample',
        repo: 'project',
      }
      const candidates = routeConnections(connections, input)
      expect(candidates.map((candidate) => candidate.id).sort()).toEqual(
        connections
          .filter((row) => row.provider === connection.provider && row.server === connection.server)
          .map((row) => row.id)
          .sort()
      )
      expect(routeConnections(connections, { ...input, explicitId: connection.id })).toEqual([
        { id: connection.id, reason: 'explicit' },
      ])
      for (const other of connections.filter(
        (row) => row.provider !== connection.provider || row.server !== connection.server
      )) {
        expect(() => routeConnections(connections, { ...input, explicitId: other.id })).toThrow(
          /another server/
        )
      }
      expect(() => routeConnections(connections, { ...input, explicitId: 'deleted' })).toThrow(
        /deleted/
      )
    })
  }

  for (const provider of providers) {
    it(`refuses transfer credential retargeting for ${provider} in merge and replace`, () => {
      const connection = connections.find((row) => row.provider === provider)!
      const settings = {
        ...DEFAULT_SETTINGS,
        github: githubSettingsFrom({ connections: [connection] }),
      }
      const entry = collectEntries(settings).find(
        (value) => value.section === 'github-connections'
      )!
      for (const destination of connections.filter(
        (row) => row.provider !== connection.provider || row.server !== connection.server
      )) {
        const moved = {
          ...entry,
          data: { ...connection, provider: destination.provider, server: destination.server },
        }
        for (const mode of ['merge', 'replace'] as const) {
          expect(() => applyEntries([moved], settings, mode)).toThrow(/credential reference/)
          expect(settings.github.connections).toEqual([connection])
        }
      }
    })

    it(`keeps Off, interactive Ask and Auto distinct for ${provider}`, async () => {
      const connection = connections.find((row) => row.provider === provider)!
      const agent = (mode: 'off' | 'ask' | 'auto') => () => ({
        id: 'sample-agent',
        githubConnections: { [connection.id]: mode },
      })
      const approve = vi.fn().mockResolvedValue(true)
      expect(connectionMode({ id: 'sample-agent' }, connection.id)).toBe('off')
      await expect(authorizeConnection(agent('off'), connection, approve)).rejects.toThrow(
        /disabled/
      )
      expect(approve).not.toHaveBeenCalled()
      await expect(authorizeConnection(agent('ask'), connection)).rejects.toThrow(/cannot ask/)
      await authorizeConnection(agent('ask'), connection, approve)
      expect(approve).toHaveBeenCalledTimes(1)
      await authorizeConnection(agent('auto'), connection, approve)
      expect(approve).toHaveBeenCalledTimes(1)
    })
  }

  it('strips mixed-case private-token headers without changing the original request', () => {
    const headers = {
      'pRiVaTe-ToKeN': 'invented-secret',
      Authorization: 'invented-secret',
      Accept: 'application/json',
    }
    expect(withoutCredentials(headers)).toEqual({ Accept: 'application/json' })
    expect(headers['pRiVaTe-ToKeN']).toBe('invented-secret')
  })
})
