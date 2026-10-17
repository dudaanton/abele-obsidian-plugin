import { describe, expect, it } from 'vitest'
import { githubSettingsFrom } from '@/github/settings'
import { routeConnections } from '@/github/connectionRouting'
import { ConnectionClients } from '@/github/connectionClients'
import { applyEntries, collectEntries } from '@/transfer/entries'
import { DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { migrateLegacyConnectionAccess } from '@/github/agentAccess'

const row = (provider: string, server = 'https://git.example.test/team') => ({
  id: provider,
  provider,
  name: 'Sample connection',
  server,
  keyId: `${provider}-slot`,
  owners: ['group/subgroup/*'],
  isDefault: true,
})

describe('provider connection migration', () => {
  it('retains public GitHub connections with the empty-server spelling', () => {
    const legacy = githubSettingsFrom({ keyId: 'public-slot' })
    expect(legacy.connections).toHaveLength(1)
    expect(legacy.keyId).toBe('public-slot')
    const explicit = githubSettingsFrom({ connections: [row('github', '')] })
    expect(explicit.connections).toEqual([row('github', '')])
    const entry = collectEntries({ ...DEFAULT_SETTINGS, github: explicit }).find(
      (e) => e.section === 'github-connections'
    )!
    expect(applyEntries([entry], DEFAULT_SETTINGS).github?.connections).toEqual(
      explicit.connections
    )
  })
  it('retains legacy credentials, explicit emptiness and the separate inbox slot', () => {
    const old = {
      server: 'https://git.example.test',
      keyId: 'sample-slot',
      notifications: { keyId: 'inbox-slot' },
    }
    const migrated = githubSettingsFrom(old)
    expect(migrated.connections[0]).toMatchObject({ id: 'github-legacy', keyId: 'sample-slot' })
    expect(migrated.notifications).toMatchObject({
      boundKeyId: 'inbox-slot',
      boundServer: old.server,
    })
    expect(githubSettingsFrom({ ...old, connections: [] })).toMatchObject({
      connections: [],
      keyId: '',
    })
    const mixed = githubSettingsFrom({
      ...migrated,
      connections: [...migrated.connections, row('forgejo')],
    })
    expect(mixed.keyId).toBe('sample-slot')
    expect(mixed.connections).toHaveLength(2)
  })
  it('does not inherit old tool grants for a non-GitHub record with the legacy ID', () => {
    const agents = [{ id: 'sample-agent', toolModes: { github_read: 'auto' as const } }]
    migrateLegacyConnectionAccess(agents, [{ ...row('future-forge'), id: 'github-legacy' }])
    expect(agents[0]).toHaveProperty('githubConnections', {})
  })
  it('retires the old client before a connection changes provider and never borrows missing keys', () => {
    const connections = [{ ...row('github', 'https://git.example.test') }]
    const registry = new ConnectionClients(
      () => connections,
      () => '',
      () => 'ready'
    )
    const original = registry.client('github')
    expect(original.tokenInfo.attached).toBe(false)
    connections[0] = { ...connections[0], provider: 'forgejo' }
    registry.reconcile()
    expect(original.isCurrent).toBe(false)
    expect(() => original.assertCurrent()).toThrow('connection changed')
    expect(() => registry.client('github')).toThrow(/provider/i)
  })
  it('preserves provider bindings without projecting them into legacy GitHub credentials', () => {
    for (const provider of ['forgejo', 'gitea', 'gitlab', 'future-forge']) {
      const settings = githubSettingsFrom({ connections: [row(provider)] })
      expect(settings.connections).toEqual([row(provider)])
      expect(settings.keyId).toBe('')
      expect(settings.server).toBe('')
      expect(githubSettingsFrom(settings).connections).toEqual(settings.connections)
    }
  })
  it('keeps independent defaults per provider and full deployment base', () => {
    const settings = githubSettingsFrom({
      connections: [
        row('forgejo'),
        row('gitea'),
        { ...row('forgejo', 'https://git.example.test/other'), id: 'other' },
      ],
    })
    expect(settings.connections.map((c) => c.isDefault)).toEqual([true, true, true])
  })
  it('never routes or constructs a GitHub client for another provider', () => {
    const connections = githubSettingsFrom({
      connections: [row('forgejo', 'https://git.example.test')],
    }).connections
    expect(
      routeConnections(connections, {
        host: 'git.example.test',
        origin: 'https://git.example.test',
        owner: 'group',
        repo: 'sample',
      })
    ).toEqual([])
    const clients = new ConnectionClients(
      () => connections,
      () => {
        throw new Error('must not read secret')
      },
      () => 'ready'
    )
    expect(() => clients.client('forgejo')).toThrow(/provider/i)
  })
  it('transfers bindings and all key references and rejects same-slot retargeting', () => {
    const github = githubSettingsFrom({ connections: [row('forgejo')] })
    const settings = { ...DEFAULT_SETTINGS, github }
    const connection = collectEntries(settings).find((e) => e.section === 'github-connections')!
    expect(connection.secretIds).toEqual(['forgejo-slot'])
    expect(applyEntries([connection], DEFAULT_SETTINGS).github?.connections).toEqual(
      github.connections
    )
    const changed = {
      ...connection,
      data: { ...row('gitea'), id: 'forgejo', keyId: 'forgejo-slot' },
    }
    expect(() => applyEntries([changed], settings)).toThrow(/credential reference/)
    const moved = { ...connection, data: { ...row('forgejo', 'https://git.example.test/other') } }
    expect(() => applyEntries([moved], settings, 'replace')).toThrow(/credential reference/)
  })
})
