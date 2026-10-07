/**
 * The sync settings as they come off disk.
 *
 * `data.json` is a plain file in the vault: an older version of the plugin wrote it, a person
 * may have edited it, and sync itself may have brought it in from another device. So the
 * migration is the guard — every field either is what it says it is or takes its default, and
 * nothing else in the file is carried into memory.
 *
 * What is left in it is only what every device on the vault shares. This device's connection
 * and what it takes live in local storage (`syncConnection.test.ts`); an older build's copy of
 * them in the file is dropped here and never written back.
 */
import { describe, it, expect } from 'vitest'
import { DEFAULT_SYNC_SETTINGS, defaultSyncSettings, migrateSyncSettings } from '@/sync/settings'

describe('defaultSyncSettings', () => {
  it('holds no key signature', () => {
    expect(defaultSyncSettings()).toEqual({ keySignature: null, sharing: [] })
  })

  it('hands back a fresh set every time, while the shared one cannot be edited', () => {
    const first = defaultSyncSettings()
    first.keySignature = { property: 'secret', value: 'yes' }

    expect(defaultSyncSettings().keySignature).toBeNull()
    expect(Object.isFrozen(DEFAULT_SYNC_SETTINGS)).toBe(true)
  })
})

describe('migrateSyncSettings', () => {
  it('gives the defaults for a settings file with no sync in it', () => {
    expect(migrateSyncSettings(undefined)).toEqual(defaultSyncSettings())
    expect(migrateSyncSettings(null)).toEqual(defaultSyncSettings())
    expect(migrateSyncSettings('nonsense')).toEqual(defaultSyncSettings())
    expect(migrateSyncSettings([])).toEqual(defaultSyncSettings())
  })

  /**
   * The server, the vault, the device, the keychain name, the pause switch and what the device
   * takes all belong to one device. A file that still holds them — an older build's, or one
   * another device's sync brought in — has them dropped on the way in.
   */
  it("drops a device's connection and what it syncs, the cap included", () => {
    const settings = migrateSyncSettings({
      serverUrl: 'https://sync.example',
      vaultId: 'v1',
      deviceId: 'd1',
      deviceTokenId: 'abele-sync-device-1',
      deviceName: 'Laptop',
      paused: true,
      selective: { video: false, maxFileBytes: 1024 },
      keySignature: { property: 'secret', value: 'yes' },
    })

    expect(settings).toEqual({ keySignature: { property: 'secret', value: 'yes' }, sharing: [] })
  })

  it('keeps unknown keys out', () => {
    const settings = migrateSyncSettings({ deviceToken: 'absd_secret', lastSeq: 42 })

    expect(Object.keys(settings)).toEqual(['keySignature', 'sharing'])
    expect(settings).not.toHaveProperty('deviceToken')
    expect(settings).not.toHaveProperty('lastSeq')
  })

  /**
   * The ledger id lives in the vault's local storage, where no file can carry it to another
   * vault. One a file still holds is dropped on the way in, and so never written back.
   */
  it('drops a ledger id the file still holds', () => {
    const raw = { stateId: 'abc123', stateVaultId: 'v1' }

    expect(migrateSyncSettings(raw)).not.toHaveProperty('stateId')
    expect(migrateSyncSettings(raw)).not.toHaveProperty('stateVaultId')
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

  it('hands back settings of its own, sharing nothing with what it read', () => {
    const raw = { keySignature: { property: 'secret', value: 'yes' } }
    const settings = migrateSyncSettings(raw)
    settings.keySignature!.value = 'no'

    expect(raw.keySignature.value).toBe('yes')
  })
})
