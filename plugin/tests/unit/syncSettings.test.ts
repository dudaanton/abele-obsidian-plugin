/**
 * The sync settings as they come off disk.
 *
 * `data.json` is a plain file in the vault: an older version of the plugin wrote it, a person
 * may have edited it, and sync itself may have brought it in from another device. So the
 * migration is the guard — every field either is what it says it is or takes its default, and
 * nothing else in the file is carried into memory.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SYNC_SETTINGS,
  MOBILE_MAX_FILE_BYTES,
  defaultSyncSettings,
  migrateSyncSettings,
} from '@/sync/settings'

describe('defaultSyncSettings', () => {
  it('starts unconfigured, running, and syncing everything', () => {
    const settings = defaultSyncSettings()

    expect(settings.serverUrl).toBe('')
    expect(settings.vaultId).toBe('')
    expect(settings.deviceId).toBe('')
    expect(settings.deviceTokenId).toBe('')
    expect(settings.deviceName).toBe('')
    expect(settings.paused).toBe(false)
    expect(settings.keySignature).toBeNull()
    expect(settings.selective.images).toBe(true)
    expect(settings.selective.excludedFolders).toEqual([])
    expect(settings.selective.settings.pluginSettings).toBe(true)
  })

  it('caps file size on a phone and nowhere else', () => {
    expect(defaultSyncSettings().selective.maxFileBytes).toBeNull()
    expect(defaultSyncSettings(true).selective.maxFileBytes).toBe(MOBILE_MAX_FILE_BYTES)
    expect(MOBILE_MAX_FILE_BYTES).toBe(50 * 1024 * 1024)
  })

  it('hands back a fresh set every time, while the shared one cannot be edited', () => {
    const first = defaultSyncSettings()
    first.selective.excludedFolders.push('Archive')

    expect(defaultSyncSettings().selective.excludedFolders).toEqual([])
    expect(Object.isFrozen(DEFAULT_SYNC_SETTINGS)).toBe(true)
    expect(Object.isFrozen(DEFAULT_SYNC_SETTINGS.selective)).toBe(true)
    expect(DEFAULT_SYNC_SETTINGS.selective.excludedFolders).toEqual([])
  })
})

describe('migrateSyncSettings', () => {
  it('gives the defaults for a settings file with no sync in it', () => {
    expect(migrateSyncSettings(undefined)).toEqual(defaultSyncSettings())
    expect(migrateSyncSettings(null)).toEqual(defaultSyncSettings())
    expect(migrateSyncSettings('nonsense')).toEqual(defaultSyncSettings())
    expect(migrateSyncSettings([])).toEqual(defaultSyncSettings())
  })

  it('keeps what was configured', () => {
    const settings = migrateSyncSettings({
      serverUrl: 'https://sync.example',
      vaultId: 'v1',
      deviceId: 'd1',
      deviceTokenId: 'abele-sync-token-1',
      deviceName: 'Laptop',
      paused: true,
    })

    expect(settings.serverUrl).toBe('https://sync.example')
    expect(settings.vaultId).toBe('v1')
    expect(settings.deviceId).toBe('d1')
    expect(settings.deviceTokenId).toBe('abele-sync-token-1')
    expect(settings.deviceName).toBe('Laptop')
    expect(settings.paused).toBe(true)
  })

  it('keeps unknown keys out', () => {
    const settings = migrateSyncSettings({
      serverUrl: 'https://sync.example',
      // What an older plugin held and what a person invented: neither is settings any more.
      deviceToken: 'absd_secret',
      lastSeq: 42,
    })

    expect(Object.keys(settings).sort()).toEqual([
      'deviceId',
      'deviceName',
      'deviceTokenId',
      'keySignature',
      'paused',
      'selective',
      'serverUrl',
      'stateId',
      'stateVaultId',
      'vaultId',
    ])
    expect((settings as Record<string, unknown>).deviceToken).toBeUndefined()
  })

  it('leaves the state id empty for a settings file written before it existed', () => {
    // Empty rather than the vault id: reusing that would put two local vaults syncing one
    // server vault back on a single ledger, which is the collision the field exists to stop.
    // The next enrolment mints one.
    const settings = migrateSyncSettings({ serverUrl: 'https://sync.example', vaultId: 'v1' })

    expect(settings.stateId).toBe('')
  })

  it('keeps a state id it was given, and the vault that ledger describes', () => {
    const settings = migrateSyncSettings({ stateId: 'abc123', stateVaultId: 'v1' })

    expect(settings.stateId).toBe('abc123')
    expect(settings.stateVaultId).toBe('v1')
    expect(migrateSyncSettings({ stateId: 7, stateVaultId: 7 }).stateId).toBe('')
    expect(migrateSyncSettings({ stateId: 7, stateVaultId: 7 }).stateVaultId).toBe('')
  })

  it('falls back to the default for a field of the wrong type', () => {
    const settings = migrateSyncSettings({
      serverUrl: 42,
      vaultId: { id: 'v1' },
      paused: 'yes',
      selective: 'everything',
    })

    expect(settings.serverUrl).toBe('')
    expect(settings.vaultId).toBe('')
    expect(settings.paused).toBe(false)
    expect(settings.selective).toEqual(defaultSyncSettings().selective)
  })

  it('fills a half-written selective block out from the defaults', () => {
    const settings = migrateSyncSettings({
      selective: {
        video: false,
        excludedFolders: ['Archive', 7, 'Scans'],
        settings: { hotkeys: false },
      },
    })

    expect(settings.selective.video).toBe(false)
    expect(settings.selective.images).toBe(true)
    expect(settings.selective.excludedFolders).toEqual(['Archive', 'Scans'])
    expect(settings.selective.settings.hotkeys).toBe(false)
    expect(settings.selective.settings.appearance).toBe(true)
  })

  it('keeps a size cap, including the one that says there is none', () => {
    expect(migrateSyncSettings({ selective: { maxFileBytes: 1024 } }).selective.maxFileBytes).toBe(
      1024
    )
    expect(
      migrateSyncSettings({ selective: { maxFileBytes: null } }).selective.maxFileBytes
    ).toBeNull()
    // Not a number at all: the default, which on this platform is no cap.
    expect(
      migrateSyncSettings({ selective: { maxFileBytes: '1024' } }).selective.maxFileBytes
    ).toBeNull()
  })

  it('takes a key signature only when it is both halves', () => {
    expect(
      migrateSyncSettings({ keySignature: { property: 'secret', value: 'yes' } }).keySignature
    ).toEqual({ property: 'secret', value: 'yes' })
    expect(migrateSyncSettings({ keySignature: { property: 'secret' } }).keySignature).toBeNull()
    expect(
      migrateSyncSettings({ keySignature: { property: '', value: 'yes' } }).keySignature
    ).toBeNull()
    expect(migrateSyncSettings({ keySignature: 'secret' }).keySignature).toBeNull()
  })

  it('caps file size on a phone that has no sync settings yet', () => {
    expect(migrateSyncSettings(undefined, true).selective.maxFileBytes).toBe(MOBILE_MAX_FILE_BYTES)
    expect(
      migrateSyncSettings({ serverUrl: 'https://sync.example' }, true).selective.maxFileBytes
    ).toBe(MOBILE_MAX_FILE_BYTES)
    expect(migrateSyncSettings(undefined).selective.maxFileBytes).toBeNull()
  })

  it('leaves a phone that already chose a cap with the one it chose', () => {
    // Including the choice to have none: a person who turned the cap off on their phone is
    // not given it back on the next launch.
    expect(
      migrateSyncSettings({ selective: { maxFileBytes: 1024 } }, true).selective.maxFileBytes
    ).toBe(1024)
    expect(
      migrateSyncSettings({ selective: { maxFileBytes: null } }, true).selective.maxFileBytes
    ).toBeNull()
  })

  it('hands back settings of its own, sharing nothing with what it read', () => {
    const raw = { selective: { excludedFolders: ['Archive'] } }
    const settings = migrateSyncSettings(raw)
    settings.selective.excludedFolders.push('Scans')

    expect(raw.selective.excludedFolders).toEqual(['Archive'])
    expect(Object.isFrozen(settings.selective)).toBe(false)
  })
})
