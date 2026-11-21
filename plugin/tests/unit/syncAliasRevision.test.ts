import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { sha256 } from '@abele/sync-sdk/core'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(['discard', 'retire'] as const)(
  'does not certify an edit during %s alias cleanup',
  async (kind) => {
    const path = 'sample.bin',
      app = buildFakeVault([{ path, content: 'original' }])
    const host = await HostSyncStorage.open(new IDBFactory(), 'sample-alias', app)
    const files = new ObsidianFileSystem(app as never)
    let clock = 'original-clock'
    vi.spyOn(files as unknown as { native: object }, 'native', 'get').mockReturnValue({
      fileContentRevision: async () => clock,
    })
    Reflect.set(files, 'fileIdentity', async () => 'sample-inode')
    const info = await app.vault.adapter.stat(path)
    const item = {
      path,
      size: 8,
      mtime: Math.round(info!.mtime),
      sha: await sha256(new TextEncoder().encode('original')),
    }
    try {
      await Reflect.get(files, 'rememberInstalled').call(files, [item])
      expect(host.scanInstallation(path)?.sha).toBe(item.sha)
      expect(host.scanInstallation(path)?.contentRevision).toBe(clock)
      const edit = async () => {
        // An external same-size write with restored mtime, before its watcher arrives.
        // Bypass the adapter's mutation notifications: only the native clock sees it.
        await app.vault.adapter.write(path, 'modified', { mtime: info!.mtime })
        clock = 'edited-clock'
      }
      if (kind === 'discard') {
        Reflect.get(files, 'bufferedInstallations').set('sample-receipt', item)
        vi.spyOn(Reflect.get(files, 'writer'), 'discardReceipt').mockImplementation(async () => {
          await edit()
          return true
        })
        await files.discardInstallation('sample-receipt')
      } else {
        await Reflect.get(files, 'retireInstalledAlias').call(
          files,
          { target: path, replacementSha: item.sha },
          edit
        )
      }
      expect(host.scanInstallation(path)?.contentRevision).not.toBe(clock)
    } finally {
      host.close()
    }
  }
)
