import { describe, expect, it, vi } from 'vitest'
import { emptyConnection, CONNECTION_KEY, writeConnection } from '@/sync/connection'
import { LEDGER_KEY, readLedgerId, writeLedgerId } from '@/sync/ledgerId'
import { EXTERNAL_SWITCH_KEY } from '@/sync/external/recovery'
import {
  stageConnectionSwitch,
  recoverConnectionSwitch,
  stageScopedDeparture,
  recoverScopedDeparture,
} from '@/sync/external/connectionSwitch'
import { SCOPED_CONNECTION_KEY } from '@/sync/scoped/scopedJoin'
import { useVault } from '../helpers/testEnv'

describe('durable personal connection replacement', () => {
  it.each(['descriptor', 'credential'])(
    'recovers scoped departure after the %s write while retaining ledger ownership',
    async (boundary) => {
      const app = useVault([])
      const old = {
        version: 4 as const,
        facet: 'scoped' as const,
        issuer: 'https://sync.example.invalid',
        vaultId: 'sample-vault',
        grantId: 'sample-grant',
        memberId: 'sample-member',
        principalId: 'sample-installation',
        principalKind: 'installation' as const,
        role: 'reader' as const,
        rootFileId: 'sample-root',
        tokenId: 'abele-scoped-installation-sample',
        ledgerId: 'sample-ledger',
        scriptPolicy: 'refuse' as const,
      }
      app.saveLocalStorage(SCOPED_CONNECTION_KEY, old)
      const values = new Map([
        [old.tokenId, 'sample-token'],
        [old.tokenId + ':binding', 'sample-proof'],
      ])
      let hit = false
      const road = {
        get: (id: string) => values.get(id) ?? '',
        set: (id: string, value: string) => {
          values.set(id, value)
          if (!hit && boundary === 'credential') {
            hit = true
            throw Error('sample termination')
          }
        },
      }
      const save = app.saveLocalStorage.bind(app)
      vi.spyOn(app, 'saveLocalStorage').mockImplementation((key, value) => {
        save(key, value)
        if (!hit && boundary === 'descriptor' && key === SCOPED_CONNECTION_KEY) {
          hit = true
          throw Error('sample termination')
        }
      })
      await expect(stageScopedDeparture(app, road, old, async () => {})).rejects.toThrow(
        'termination'
      )
      expect(hit).toBe(true)
      await recoverScopedDeparture(app, road)
      expect(app.loadLocalStorage(SCOPED_CONNECTION_KEY)).toBeNull()
      expect(app.loadLocalStorage(EXTERNAL_SWITCH_KEY)).toBeNull()
      expect(road.get(old.tokenId)).toBe('')
      vi.restoreAllMocks()
    }
  )
  it.each(['credential-proof', 'credential-value', 'descriptor', 'connection'])(
    'recovers after %s write without reusing the active credential or bootstrapping the old ledger',
    async (boundary) => {
      const app = useVault([])
      const old = {
        ...emptyConnection(),
        migrated: true,
        serverUrl: 'https://sync.example.invalid',
        enrolledUrl: 'https://sync.example.invalid',
        vaultId: 'sample-old',
        deviceId: 'sample-old-device',
        deviceTokenId: 'abele-sync-device-sample-old',
      }
      const target = {
        ...old,
        vaultId: 'sample-target',
        deviceId: 'sample-target-device',
        deviceTokenId: 'abele-sync-device-sample-new',
      }
      const oldLedger = { stateId: 'sample-old-ledger', vaultId: old.vaultId }
      const targetLedger = { stateId: 'sample-new-ledger', vaultId: target.vaultId }
      writeConnection(app, old)
      writeLedgerId(app, oldLedger)
      const values = new Map<string, string>()
      const road = {
        get: (id: string) => values.get(id) ?? '',
        set: (id: string, value: string) => {
          values.set(id, value)
        },
      }
      let hit = false
      const set = road.set
      road.set = (id, value) => {
        set(id, value)
        if (
          !hit &&
          ((boundary === 'credential-proof' && id.endsWith('-server')) ||
            (boundary === 'credential-value' && id === target.deviceTokenId))
        ) {
          hit = true
          throw Error('sample termination')
        }
      }
      const save = app.saveLocalStorage.bind(app)
      vi.spyOn(app, 'saveLocalStorage').mockImplementation((key, value) => {
        save(key, value)
        if (
          !hit &&
          ((boundary === 'descriptor' && key === LEDGER_KEY) ||
            (boundary === 'connection' && key === CONNECTION_KEY))
        ) {
          hit = true
          throw Error('sample termination')
        }
      })
      await expect(
        stageConnectionSwitch(app, road, target, targetLedger, 'absd_sample_new', async () => {})
      ).rejects.toThrow('termination')
      expect(hit).toBe(true)
      expect(app.loadLocalStorage(EXTERNAL_SWITCH_KEY)).not.toBeNull()
      road.set = set
      if (boundary === 'credential-proof') {
        await expect(recoverConnectionSwitch(app, road)).rejects.toThrow(/recovery/i)
        expect(readLedgerId(app)).toEqual(oldLedger)
        expect(app.loadLocalStorage(CONNECTION_KEY)).toEqual(old)
      } else {
        await recoverConnectionSwitch(app, road)
        expect(readLedgerId(app)).toEqual(targetLedger)
        expect(app.loadLocalStorage(CONNECTION_KEY)).toEqual(target)
        expect(app.loadLocalStorage(EXTERNAL_SWITCH_KEY)).toBeNull()
      }
      expect(road.get(old.deviceTokenId)).toBe('')
      vi.restoreAllMocks()
    }
  )

  it('does not stage any credential or descriptor when the shared safety prerequisite fails', async () => {
    const app = useVault([]),
      road = { get: () => '', set: vi.fn() }
    await expect(
      stageConnectionSwitch(
        app,
        road,
        emptyConnection(),
        { stateId: 'sample-new', vaultId: 'sample-target' },
        'absd_sample',
        async () => {
          throw Error('unresolved inventory')
        }
      )
    ).rejects.toThrow('inventory')
    expect(road.set).not.toHaveBeenCalled()
    expect(app.loadLocalStorage(EXTERNAL_SWITCH_KEY)).toBeNull()
  })
})
