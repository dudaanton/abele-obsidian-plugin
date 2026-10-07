import { expect, it } from 'vitest'
import { collectEntries, buildPayload } from '@/transfer/entries'
import { migrateSyncSettings } from '@/sync/settings'
import { audiencesFor } from '@/sync/sharing/sharingCatalogue'

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
it('does not accept malformed or oversized sharing catalogues', () => {
  for (const sharing of [
    null,
    'sample',
    [{ issuer: 'http://unsafe.example', vaultId: 'sample', grants: ['group'] }],
    [{ issuer: 'https://sync.example', vaultId: 'sample-vault', grants: [''] }],
  ]) {
    expect(
      audiencesFor(migrateSyncSettings({ sharing }), 'https://sync.example', 'sample-vault')
    ).toEqual([])
  }
})
