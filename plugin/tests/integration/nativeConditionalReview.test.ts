// @vitest-environment node
import '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { requireExternalLifecycleSafety } from '@/sync/external/pluginSafety'
import { nativeVault } from '../helpers/nativeRestartVault'
import { connectionJournalApp } from '@/sync/connectionScope'
import type { ConditionalFileHost } from '@/sync/conditionalFiles'

it.each([
  [false, 'review', 'none'],
  [true, 'review', 'none'],
  [false, 'active', 'none'],
  [true, 'review', 'restored'],
  [true, 'review', 'intent'],
  [true, 'review', 'empty-intent'],
  [true, 'review', 'archive'],
  [true, 'review', 'pointer'],
  [false, 'review', 'foreign-data'],
] as const)(
  'settles an interrupted native write without losing either payload (occupied=%s, area=%s, cut=%s)',
  async (occupied, initialArea, cut) => {
    const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-review-')))
    const area = '.abele-sync/connections/sample-owner/conditional'
    const folder = area + '/objects/sample-receipt'
    const path = 'Sample/note.md'
    try {
      await disk.mkdir(join(root, folder, 'restore-plans'), { recursive: true })
      await disk.mkdir(join(root, area, initialArea), { recursive: true })
      await disk.mkdir(join(root, 'Sample'), { recursive: true })
      await disk.writeFile(join(root, folder, 'victim'), 'original local bytes')
      await disk.writeFile(join(root, folder, 'data'), 'incoming bytes retained after the cut')
      await disk.writeFile(join(root, folder, 'allocation'), '')
      const intent = {
        receipt: true,
        path,
        expected: { size: 20, mtime: 1000, sha: 'a'.repeat(64) },
        destination: path,
        data: cut === 'foreign-data' ? 'Other/private-data' : folder + '/data',
        kind: 'write',
      }
      await disk.writeFile(join(root, folder, 'intent.json'), JSON.stringify(intent))
      await disk.writeFile(
        join(root, area, initialArea + '/sample-receipt.json'),
        JSON.stringify(intent)
      )
      await disk.writeFile(
        join(root, folder, 'restore-plans/sample-plan.json'),
        JSON.stringify({ destination: path })
      )
      if (occupied) await disk.writeFile(join(root, path), 'newer editor save')
      else await disk.link(join(root, folder, 'victim'), join(root, path))
      const app = connectionJournalApp(nativeVault(root, disk) as never, 'sample-owner')
      const options = { journalOwner: 'sample-owner' }
      await expect(requireExternalLifecycleSafety(app as never, new IDBFactory())).rejects.toThrow(
        'conditional file recovery'
      )
      const first = new ObsidianFileSystem(app, options)
      if (cut === 'foreign-data') {
        await expect(first.recover()).rejects.toThrow('conditional recovery remains pending')
        await expect(
          requireExternalLifecycleSafety(app as never, new IDBFactory())
        ).rejects.toThrow('conditional file recovery')
        expect(await disk.readFile(join(root, folder, 'victim'), 'utf8')).toBe(
          'original local bytes'
        )
        expect(await disk.readFile(join(root, folder, 'data'), 'utf8')).toBe(
          'incoming bytes retained after the cut'
        )
        expect(await disk.stat(join(root, area, 'recovered')).catch(() => null)).toBeNull()
        return
      }
      if (cut !== 'none') {
        const host = Reflect.get(Reflect.get(first, 'conditional'), 'host') as ConditionalFileHost
        const flush = host.flush,
          create = host.create,
          move = host.restoreDirectory!,
          remove = host.remove
        let killed = false
        const stop = () => {
          killed = true
          throw new Error('sample process cut')
        }
        host.check = () => {
          if (killed) throw new Error('sample process cut')
        }
        host.flush = async (path, parentsOnly) => {
          host.check()
          await flush(path, parentsOnly)
          if (
            (cut === 'intent' && path.endsWith('/retiring/sample-receipt.json')) ||
            (cut === 'restored' && path.endsWith('/objects/sample-receipt/restored'))
          )
            stop()
        }
        host.create = async (path, bytes, mtime) => {
          host.check()
          if (cut === 'empty-intent' && path.endsWith('/retiring/sample-receipt.json')) {
            await create(path, new Uint8Array(), mtime)
            stop()
          }
          await create(path, bytes, mtime)
        }
        host.restoreDirectory = async (from, to) => {
          host.check()
          await move(from, to)
          if (cut === 'archive' && to.includes('/recovered/')) stop()
        }
        host.remove = async (path) => {
          host.check()
          await remove(path)
          if (cut === 'pointer' && path.endsWith('/review/sample-receipt.json')) stop()
        }
        await expect(first.recover()).rejects.toThrow('conditional recovery remains pending')
        expect(killed).toBe(true)
      } else await first.recover()
      await new ObsidianFileSystem(app, options).recover()
      await expect(
        requireExternalLifecycleSafety(app as never, new IDBFactory())
      ).resolves.toBeUndefined()
      await new ObsidianFileSystem(app, options).recover()
      const names = await disk.readdir(join(root, 'Sample'))
      const contents = await Promise.all(
        names.map((name) => disk.readFile(join(root, 'Sample', name), 'utf8'))
      )
      expect(contents).toContain('original local bytes')
      expect(await disk.readFile(join(root, path), 'utf8')).toBe(
        occupied ? 'newer editor save' : 'original local bytes'
      )
      const archives = await disk.readdir(join(root, area, 'recovered'))
      expect(archives).toHaveLength(1)
      expect(await disk.readFile(join(root, area, 'recovered', archives[0], 'data'), 'utf8')).toBe(
        'incoming bytes retained after the cut'
      )
      expect(
        await disk.readFile(join(root, area, 'recovered', archives[0], 'victim'), 'utf8')
      ).toBe('original local bytes')
      const retry = new ObsidianFileSystem(app, options)
      expect(
        await retry.conditionalFile({
          path,
          expected: await retry.fingerprint(path),
          effect: {
            kind: 'write',
            receipt: 'sample-receipt',
            bytes: new TextEncoder().encode('verified server retry'),
            mtime: 2000,
          },
        })
      ).toBe(true)
      await retry.discardInstallation('sample-receipt')
      expect(await disk.readFile(join(root, path), 'utf8')).toBe('verified server retry')
      expect(await disk.readFile(join(root, area, 'recovered', archives[0], 'data'), 'utf8')).toBe(
        'incoming bytes retained after the cut'
      )
    } finally {
      await disk.rm(root, { recursive: true, force: true })
    }
  },
  // Real restart, retry and cleanup perform dozens of fsync barriers plus thousands
  // of path checks; allow shared-disk contention without changing recovery assertions.
  30_000
)
