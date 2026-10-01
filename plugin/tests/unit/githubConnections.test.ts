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

  it('retains a legacy API-address spelling with a trailing slash and the same key slot', () => {
    const settings = githubSettingsFrom({
      server: 'https://Git.Example.test/api/v3/',
      keyId: 'legacy-slot',
    })
    expect(settings.connections).toHaveLength(1)
    expect(settings.connections[0].keyId).toBe('legacy-slot')
  })

  it('keeps a server-only connection; never fabricates one for untouched anonymous settings', () => {
    expect(githubSettingsFrom({ server: legacy.server }).connections).toHaveLength(1)
    expect(githubSettingsFrom().connections).toEqual([])
  })

  it('never resurrects a deleted legacy connection, even while legacy fields are still present', () => {
    expect(githubSettingsFrom({ ...legacy, connections: [] }).connections).toEqual([])
    expect(githubSettingsFrom({ ...legacy, connections: [] }).keyId).toBe('')
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

  it('hides the classic legacy alias when the last Enterprise connection is removed', () => {
    const settings = githubSettingsFrom({ ...legacy, notifications: { keyId: 'classic-key' } })
    settings.connections = []
    const projected = projectLegacy(settings)
    expect(projected.server).toBe('')
    expect(projected.notifications.keyId).toBe('')
    expect(projected.notifications.boundKeyId).toBe('classic-key')
    expect(projected.notifications.boundServer).toBe(legacy.server)
  })

  it('binds a classic notifications credential to its original server after changing the projection', () => {
    const settings = githubSettingsFrom({ ...legacy, notifications: { keyId: 'classic-key' } })
    settings.connections = [
      {
        id: 'public',
        name: 'Public',
        server: '',
        keyId: 'public-key',
        owners: [],
        isDefault: true,
      },
    ]
    const saved = projectLegacy(settings)
    expect(saved.server).toBe('')
    expect(saved.notifications.keyId).toBe('') // an older version must not attach it to public GitHub
    expect(saved.notifications.boundKeyId).toBe('classic-key')
    expect(saved.notifications.boundServer).toBe(legacy.server)
    expect(githubSettingsFrom(saved).notifications.boundKeyId).toBe('classic-key')
  })

  it('does not restore an abandoned legacy projection server if it is later added again', () => {
    const first = githubSettingsFrom(legacy)
    first.connections = [
      {
        id: 'public',
        name: 'Public',
        server: '',
        keyId: 'public-slot',
        owners: [],
        isDefault: true,
      },
    ]
    const projected = projectLegacy(first)
    projected.connections.push({
      id: 'enterprise-again',
      name: 'Enterprise again',
      server: legacy.server,
      keyId: 'new-slot',
      owners: [],
      isDefault: true,
    })
    expect(projectLegacy(projected).keyId).toBe('public-slot')
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
  it('normalizes defaults only after all selected connections arrive, preserving a later default', () => {
    const original={...DEFAULT_SETTINGS,github:githubSettingsFrom({connections:[
      {id:'first',name:'First',server:'',keyId:'first-key',owners:[],isDefault:false},
      {id:'second',name:'Second',server:'',keyId:'second-key',owners:[],isDefault:true},
    ]})}
    const entries=collectEntries(original).filter(e=>e.section==='github-connections'||e.section==='github')
    for(const batch of [entries,[...entries].reverse()]) {
      const imported=applyEntries(batch,{...DEFAULT_SETTINGS,github:githubSettingsFrom()},'replace')
      expect(imported.github?.connections.find(c=>c.id==='second')?.isDefault).toBe(true)
      expect(imported.github?.connections.find(c=>c.id==='first')?.isDefault).toBe(false)
    }
  })

  it('refuses a legacy token whose slot already belongs to another server, before settings change', () => {
    const current = { ...DEFAULT_SETTINGS, github: githubSettingsFrom(legacy) }
    const incoming = {
      section: 'github' as const,
      id: 'github',
      label: 'GitHub',
      secretIds: ['old-slot'],
      data: { github: { keyId: 'old-slot', server: 'https://other.example.test' } },
    }
    expect(() => applyEntries([incoming], current)).toThrow(/another server/i)
    expect(current.github.server).toBe(legacy.server)
  })

  it('rejects a malformed connection instead of applying its token to an existing slot', () => {
    const current = { ...DEFAULT_SETTINGS, github: githubSettingsFrom(legacy) }
    const incoming = {
      section: 'github-connections' as const,
      id: 'new',
      label: 'New',
      secretIds: ['old-slot'],
      data: {
        id: 'new',
        name: 'New',
        keyId: 'old-slot',
        server: 'https://',
        owners: [],
        isDefault: false,
      },
    }
    expect(() => applyEntries([incoming], current)).toThrow(/invalid.*connection/i)
  })

  it('never lets two servers share an imported credential reference', () => {
    const current = { ...DEFAULT_SETTINGS, github: githubSettingsFrom(legacy) }
    const incoming = {
      section: 'github-connections' as const,
      id: 'new',
      label: 'New',
      secretIds: ['old-slot'],
      data: {
        id: 'new',
        name: 'New',
        keyId: 'old-slot',
        server: 'https://other.example.test',
        owners: [],
        isDefault: false,
      },
    }
    expect(() => applyEntries([incoming], current)).toThrow(/another server|different servers/i)
  })

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
