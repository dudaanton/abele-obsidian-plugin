import { expect, it } from 'vitest'
import { collectEntries, buildPayload } from '@/transfer/entries'
import { migrateSyncSettings } from '@/sync/settings'
import { audiencesFor, groupsFor } from '@/sync/sharing/sharingCatalogue'

it('carries authenticated sharing choices to another personal device, bound to its server and vault', () => {
  const incoming = {
    sharing: [
      { issuer: 'https://sync.example', vaultId: 'sample-vault', grants: ['sample-group'] },
    ],
  }
  const settings = migrateSyncSettings(JSON.parse(JSON.stringify(incoming)))
  expect(audiencesFor(settings, 'https://sync.example', 'sample-vault')).toEqual(['sample-group'])
  const [entry] = collectEntries({ sync: settings } as never).filter(
    (entry) => entry.section === 'sync'
  )
  const payload = buildPayload([entry], () => 'must-not-export-a-secret')
  expect(entry.data).toEqual({ sync: settings })
  expect(payload.secrets).toEqual({})
  expect(audiencesFor(settings, 'https://other.example', 'sample-vault')).toEqual([])
  expect(audiencesFor(settings, 'https://sync.example', 'other-vault')).toEqual([])
})
it('transfers remembered group reviews as bound hints, not credentials or current server authority', () => {
  const group = {
    id: 'sample-group',
    label: 'Sample group',
    rootId: 'sample-root',
    role: 'editor',
    revision: 7,
    state: 'active',
  }
  const settings = migrateSyncSettings({
    sharing: [
      { issuer: 'https://sync.example', vaultId: 'sample-vault', grants: [], groups: [group] },
    ],
  })
  expect(audiencesFor(settings, 'https://sync.example', 'sample-vault')).toEqual([group.id])
  expect(groupsFor(settings, 'https://sync.example', 'sample-vault')).toEqual([group])
  expect(groupsFor(settings, 'https://other.example', 'sample-vault')).toEqual([])
  const entry = collectEntries({ sync: settings } as never).find(
    (entry) => entry.section === 'sync'
  )!
  expect(buildPayload([entry], () => 'must-not-export-a-secret').secrets).toEqual({})
  const copied = groupsFor(settings, 'https://sync.example', 'sample-vault')
  copied[0].revision = 99
  expect(settings.sharing[0].groups![0].revision).toBe(7)
})
it('retains the server-sized discovery inventory without widening publication unit budgets', () => {
  const grants = Array.from({ length: 64 }, (_, index) => `sample-share-${index}`)
  const migrate = (ids: string[]) =>
    migrateSyncSettings({
      sharing: [{ issuer: 'https://sync.example', vaultId: 'sample-vault', grants: ids }],
    })
  expect(audiencesFor(migrate(grants), 'https://sync.example', 'sample-vault')).toEqual(grants)
  expect(() =>
    audiencesFor(migrate([...grants, 'too-many']), 'https://sync.example', 'sample-vault')
  ).toThrow(/discovery/i)
})
it('reports an invalid group entry without erasing the valid hints beside it', () => {
  const valid = {
    id: 'sample-group',
    label: 'Sample group',
    rootId: 'sample-root',
    role: 'editor',
    revision: 3,
    state: 'active',
  }
  const raw = {
    sharing: [
      {
        issuer: 'https://sync.example',
        vaultId: 'sample-vault',
        grants: ['sample-group'],
        groups: [valid, { ...valid, id: 'broken-group', revision: 'invalid' }],
      },
    ],
  }
  const settings = migrateSyncSettings(raw)
  expect(settings.sharing[0].groups).toEqual(raw.sharing[0].groups)
  expect(() => groupsFor(settings, 'https://sync.example', 'sample-vault')).toThrow(/discovery/i)
  expect(() => audiencesFor(settings, 'https://sync.example', 'sample-vault')).toThrow(/discovery/i)
})
it('does not accept malformed or oversized sharing catalogues', () => {
  for (const sharing of [
    null,
    'sample',
    [{ issuer: 'http://unsafe.example', vaultId: 'sample', grants: ['group'] }],
    [{ issuer: 'https://sync.example', vaultId: 'sample-vault', grants: [''] }],
  ]) {
    const settings = migrateSyncSettings({ sharing })
    expect(settings.sharing).toEqual(sharing)
    expect(() => audiencesFor(settings, 'https://sync.example', 'sample-vault')).toThrow(
      /discovery/i
    )
  }
})
