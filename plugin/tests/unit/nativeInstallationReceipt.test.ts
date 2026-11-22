import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(['valid', 'content', 'identity', 'mtime', 'mutation'])(
  'checks a persisted native installation without reading bytes (%s)',
  async (mode) => {
    const app = buildFakeVault([{ path: 'sample.md', content: 'sample', mtime: 1000 }])
    const host = await HostSyncStorage.open(new IDBFactory(), 'sample-installation', app)
    try {
      const path = 'sample.md'
      const receipt = {
        identity: 'sample-identity',
        contentRevision: 'sample-content',
        sha: 'a'.repeat(64),
        size: 6,
        mtime: 1000,
        ctime: 100,
        installation: true as const,
      }
      await host.writeScanFingerprint(path, receipt)
      expect(host.scanInstallation(path)).toBeUndefined()
      const fs = new ObsidianFileSystem(app as never)
      Object.defineProperty(fs, 'native', {
        value: {
          fileContentRevision: async () =>
            mode === 'content' ? 'changed' : receipt.contentRevision,
        },
      })
      Object.assign(fs, {
        fileIdentity: async () => (mode === 'identity' ? 'changed' : receipt.identity),
        rawStat: async () => ({
          type: 'file',
          size: 6,
          mtime: mode === 'mtime' ? 2000 : 1000,
          ctime: 100,
        }),
      })
      if (mode === 'mutation') {
        const read = host.readScanFingerprint.bind(host)
        vi.spyOn(host, 'readScanFingerprint').mockImplementation(async (path) => {
          const value = await read(path)
          await host.withScanMutation([path], async () => {})
          return value
        })
      }
      const read = vi.spyOn(app.vault.adapter, 'readBinary')
      expect(await fs.verifiedInstallation(path, receipt)).toBe(mode === 'valid')
      expect(read).not.toHaveBeenCalled()
    } finally {
      host.close()
    }
  }
)
