import { describe, expect, it } from 'vitest'
import { githubSettingsFrom } from '@/github/settings'
import { projectLegacy, preferredConnection } from '@/github/connections'
import { applyEntries, buildPayload, collectEntries } from '@/transfer/entries'
import { DEFAULT_SETTINGS } from '@/services/AbeleConfig'

const legacy = { enabled: true, server: 'https://git.example.test', keyId: 'old-slot' }

describe('GitHub connection migration', () => {
  it('keeps the old slot and server, with a stable identity across devices', () => {
    const one = githubSettingsFrom(legacy)
    const two = githubSettingsFrom(legacy)
    expect(one.connections).toEqual([
      {
        id: 'github-legacy',
        name: 'GitHub Enterprise',
        server: legacy.server,
        keyId: 'old-slot',
        owners: [],
        isDefault: true,
      },
    ])
    expect(two.connections).toEqual(one.connections)
    expect(githubSettingsFrom(one).connections).toEqual(one.connections)
  })

  it('keeps a server-only connection; never fabricates one for untouched anonymous settings', () => {
    expect(githubSettingsFrom({ server: legacy.server }).connections).toHaveLength(1)
    expect(githubSettingsFrom().connections).toEqual([])
  })

  it('never resurrects a deleted legacy connection, even while legacy fields are still present', () => {
    expect(githubSettingsFrom({ ...legacy, connections: [] }).connections).toEqual([])
    expect(projectLegacy(githubSettingsFrom({ ...legacy, connections: [] }))).toMatchObject({
      server: '',
      keyId: '',
    })
  })

  it('never maps an invalid server or a nonstandard public port to a public credential', () => {
    expect(
      githubSettingsFrom({
        connections: [
          {
            id: 'bad',
            name: 'Bad',
            server: 'https://github.com:8443',
            keyId: 'private',
            owners: [],
            isDefault: true,
          },
          {
            id: 'wrong',
            name: 'Wrong',
            server: 'https://git.example.test/path',
            keyId: 'private',
            owners: [],
            isDefault: true,
          },
          {
            id: 'public',
            name: 'Public',
            server: 'https://github.com',
            keyId: 'public',
            owners: [],
            isDefault: true,
          },
        ],
      }).connections
    ).toEqual([
      { id: 'public', name: 'Public', server: '', keyId: 'public', owners: [], isDefault: true },
    ])
  })

  it('normalizes invalid/duplicate rows and defaults independently per server', () => {
    const rows = githubSettingsFrom({
      connections: [
        { id: 'a', name: 'One', server: '', keyId: 'one', owners: ['sample/*'], isDefault: true },
        { id: 'b', name: 'Two', server: '', keyId: 'two', owners: [], isDefault: true },
        {
          id: 'c',
          name: 'Enterprise',
          server: legacy.server,
          keyId: 'three',
          owners: [],
          isDefault: false,
        },
        { id: 'a', name: 'Duplicate ID', server: '', keyId: 'bad', owners: [], isDefault: false },
        null as never,
      ],
    })
    expect(rows.connections.map((r) => [r.id, r.isDefault])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ])
    expect(preferredConnection(rows.connections)?.id).toBe('a')
    rows.connections[0].owners.push('changed')
    expect(githubSettingsFrom({ connections: rows.connections }).connections[0].owners).toEqual([
      'sample/*',
      'changed',
    ])
  })

  it('keeps the migrated Enterprise server as the legacy projection when public is added', () => {
    const settings = githubSettingsFrom({ ...legacy, defaultRepo: 'sample/project' })
    settings.connections.push({
      id: 'public',
      name: 'Public',
      server: '',
      keyId: 'public-slot',
      owners: [],
      isDefault: true,
    })
    expect(projectLegacy(settings)).toMatchObject({
      server: legacy.server,
      keyId: 'old-slot',
      defaultRepo: 'https://git.example.test/sample/project',
    })
    settings.connections = settings.connections.filter((c) => c.id !== 'github-legacy')
    expect(projectLegacy(settings)).toMatchObject({ server: '', keyId: 'public-slot' })
  })
})

describe('connection transfer', () => {
  const settings = { ...DEFAULT_SETTINGS, github: githubSettingsFrom(legacy) }
  it('offers separate selectable entries and only selected tokens', () => {
    const entries = collectEntries(settings)
    const block = entries.find((e) => e.section === 'github')!
    const row = entries.find((e) => e.section === 'github-connections')!
    expect(block.data).not.toHaveProperty('github.connections')
    expect(JSON.stringify(block.data)).not.toContain('old-slot')
    expect(block.secretIds).not.toContain('old-slot')
    expect(row.secretIds).toEqual(['old-slot'])
    expect(buildPayload([block], (id) => (id === 'old-slot' ? 'fake-secret' : '')).secrets).toEqual(
      {}
    )
    expect(buildPayload([row], (id) => (id === 'old-slot' ? 'fake-secret' : '')).secrets).toEqual({
      'old-slot': 'fake-secret',
    })
  })

  it('prefers a selected connection to a stale legacy block regardless of entry order', () => {
    const row = {
      ...collectEntries(settings).find((e) => e.section === 'github-connections')!,
      id: 'new',
      data: { ...settings.github.connections[0], id: 'new' },
    }
    const block = {
      section: 'github' as const,
      id: 'github',
      label: 'GitHub',
      data: { github: { keyId: 'stale-key', server: '' } },
    }
    const empty = { ...DEFAULT_SETTINGS, github: githubSettingsFrom({ connections: [] }) }
    for (const entries of [
      [block, row],
      [row, block],
    ]) {
      const received = applyEntries(entries, empty)
      expect(received.github?.connections).toEqual([row.data])
      expect(received.github?.keyId).toBe('old-slot')
    }
  })

  it('merges by stable id, and ignores stale legacy fields when a list exists', () => {
    const row = collectEntries(settings).find((e) => e.section === 'github-connections')!
    const received = applyEntries([row], {
      ...DEFAULT_SETTINGS,
      github: githubSettingsFrom({ connections: [] }),
    })
    expect(received.github?.connections).toEqual(settings.github.connections)
    const legacyBlock = {
      section: 'github' as const,
      id: 'github',
      label: 'GitHub',
      data: { github: legacy },
    }
    const again = applyEntries([legacyBlock], received)
    expect(again.github?.connections).toEqual(settings.github.connections)
  })
})
