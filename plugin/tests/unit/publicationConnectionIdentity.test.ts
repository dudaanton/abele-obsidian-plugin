import { afterEach, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore } from '@abele/sync-core'
import { PluginSharing } from '@/sync/pluginSharing'
import { PublicationPrompt } from '@/sync/publicationPrompt'
import { emptyConnection } from '@/sync/connection'
import { writeLedgerId } from '@/sync/ledgerId'
import { bindDeviceToken } from '@/secrets/deviceSecret'
import { secrets, setSecrets } from '@/secrets/SecretStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useVault } from '../helpers/testEnv'

const hosts: PluginSharing[] = []
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close()
  setSecrets(null)
})

it.each(['reenrolment', 'forget', 'another-vault'] as const)(
  'opens a separate publication identity on %s without blocking an unshared personal connection',
  async (change) => {
    const app = useVault([])
    setSecrets(null)
    AbeleConfig.getInstance().applySettings()
    const factory = new IDBFactory()
    const connection = ref({
      ...emptyConnection(),
      serverUrl: 'https://sync.example',
      vaultId: 'sample-vault',
      deviceId: 'sample-device',
      deviceTokenId: 'abele-sync-device-sample',
    })
    const sync = {
      connection,
      publicationPrompt: new PublicationPrompt(() => true),
      scopedStatus: vi.fn(),
    }
    const host = new PluginSharing(app as never, sync as never, {
      indexedDB: factory,
      fetch: vi.fn() as never,
    })
    hosts.push(host)
    const token = 'absd_' + 'a'.repeat(43)
    const open = async (ledgerId: string) => {
      writeLedgerId(app, { stateId: ledgerId, vaultId: connection.value.vaultId })
      bindDeviceToken(
        secrets().device,
        connection.value.deviceTokenId,
        token,
        connection.value.serverUrl
      )
      return host.ownerPublication({
        app: app as never,
        connection: connection.value,
        token,
        client: { commitRaw: vi.fn() } as never,
        state: new MemoryStateStore(),
        fetch: vi.fn() as never,
        held: () => true,
      })
    }
    const original = await open('sample-ledger')
    // Retained old-identity work must neither disappear nor become a new principal's work.
    const old = (host as any).live.resources.meta
    const oldName = (host as any).live.resources.databaseName
    await old.setMeta('sample-retained-work', 'invented-pending-intent')
    original.close()
    connection.value = {
      ...connection.value,
      deviceId: 'sample-new-device',
      vaultId: change === 'another-vault' ? 'sample-other-vault' : 'sample-vault',
    }
    const replacement = await open(change === 'reenrolment' ? 'sample-ledger' : 'sample-new-ledger')
    expect((host as any).live.resources.databaseName).not.toBe(oldName)
    expect(host.audiences.value).toEqual([])
    expect(await (host as any).live.resources.meta.getMeta('sample-retained-work')).toBeNull()
    replacement.close()
    connection.value = { ...connection.value, deviceId: 'sample-device', vaultId: 'sample-vault' }
    const restored = await open('sample-ledger')
    expect((host as any).live.resources.databaseName).toBe(oldName)
    expect(await (host as any).live.resources.meta.getMeta('sample-retained-work')).toBe(
      'invented-pending-intent'
    )
    restored.close()
  }
)
