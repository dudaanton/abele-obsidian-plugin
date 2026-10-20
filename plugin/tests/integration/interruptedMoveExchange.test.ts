// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  MemoryStateStore,
  SyncEngine,
  V2EngineClient,
  recoverPendingPullWrites,
  sha256,
} from '@abele/sync-sdk/core'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { selectiveFrom } from '@/sync/connection'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([false, true])(
  'preserves a recreated source across startup recovery and subsequent server exchanges (interrupted separation=%s)',
  async (interrupt) => {
    const server = await v2Server()
    let engine: SyncEngine | undefined
    const debug = vi.spyOn(console, 'debug')
    try {
      const user = await createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
      const client = new V2EngineClient(user.token, { fetch: globalThis.fetch })
      let request = 0
      const seed = (ops: Parameters<typeof client.commit>[0]) =>
        client.commit(ops, `sample-${++request}`)
      const create = async (path: string, text: string) => {
        const bytes = new TextEncoder().encode(text)
        const sha = await sha256(bytes)
        await client.putBlob(sha, bytes)
        return { op: 'create' as const, path, sha, size: bytes.length, mtime: 1000 }
      }
      const created = (await seed([await create('Shared/a.bin', 'remote sample')])).results[0]
      if (created.status !== 'applied') throw new Error('Sample create failed')
      const moved = (
        await seed([
          {
            op: 'move',
            file_id: created.file_id,
            base_version_id: created.version_id,
            to_path: 'Shared/b.bin',
          },
        ])
      ).results[0]
      if (moved.status !== 'applied') throw new Error('Sample move failed')
      const app = buildFakeVault([
        { path: 'Shared/a.bin', content: 'independent local sample', mtime: 3000 },
      ])
      const state = new MemoryStateStore()
      const originalStat = await app.vault.adapter.stat('Shared/a.bin')
      const writes = vi.spyOn(app.vault.adapter, 'writeBinary')
      const renames = vi.spyOn(app.vault.adapter, 'rename')
      const sha = await sha256(new TextEncoder().encode('remote sample'))
      const base = {
        path: 'Shared/a.bin',
        wirePath: 'Shared/a.bin',
        fileId: created.file_id,
        versionId: created.version_id,
        sha,
        size: 13,
        mtime: 1000,
      }
      await state.put(base)
      // Durable state at publication-before-ledger; the published destination was then deleted
      // and the old source independently recreated while the process was offline.
      await state.setMeta(
        `pull-write:${created.file_id}`,
        JSON.stringify({
          fileId: created.file_id,
          versionId: moved.version_id,
          target: 'Shared/b.bin',
          wirePath: 'Shared/b.bin',
          from: base.path,
          base,
          sha,
          size: 13,
          mtime: 1000,
        })
      )
      let disk = new ObsidianFileSystem(app as never)
      await disk.recover()
      let fs = coordinatedFileSystem(disk, new PathCoordinator())
      if (interrupt) {
        const unavailable = vi
          .spyOn(client, 'openVersion')
          .mockRejectedValueOnce(new Error('Sample network unavailable'))
        await expect(
          recoverPendingPullWrites(fs, state, [created.file_id], client)
        ).rejects.toThrow('Sample network unavailable')
        expect((await state.byFileId(created.file_id))?.path).toBe('Shared/b.bin')
        expect(JSON.parse((await state.getMeta(`pull-write:${created.file_id}`))!)).toMatchObject({
          from: null,
          base: { path: 'Shared/b.bin' },
        })
        expect(new TextDecoder().decode(await app.vault.adapter.readBinary('Shared/a.bin'))).toBe(
          'independent local sample'
        )
        unavailable.mockRestore()
        app.vault.adapter = new Proxy(app.vault.adapter, {})
        disk = new ObsidianFileSystem(app as never)
        await disk.recover()
        fs = coordinatedFileSystem(disk, new PathCoordinator())
      }
      await recoverPendingPullWrites(fs, state, [created.file_id], client)
      engine = new SyncEngine({ fs, state, client, selective: selectiveFrom(undefined) })
      await seed([await create('Shared/other.md', 'unrelated remote sample')])
      await engine.sync()
      expect(new TextDecoder().decode(await app.vault.adapter.readBinary('Shared/a.bin'))).toBe(
        'independent local sample'
      )
      expect(new TextDecoder().decode(await app.vault.adapter.readBinary('Shared/b.bin'))).toBe(
        'remote sample'
      )
      expect(await app.vault.adapter.exists('Shared/other.md')).toBe(true)
      expect(await state.getMeta(`pull-write:${created.file_id}`)).toBeNull()
      const local = await state.get('Shared/a.bin')
      expect(local?.fileId).not.toBe(created.file_id)
      expect(local).not.toBeNull()
      expect(new TextDecoder().decode(await client.getBlob(local!.sha))).toBe(
        'independent local sample'
      )
      await app.vault.adapter.writeBinary(
        'Shared/other.md',
        new TextEncoder().encode('next local sample').buffer,
        { mtime: 4000 }
      )
      await engine.sync()
      await engine.sync()
      const exchanged = await state.get('Shared/other.md')
      expect(new TextDecoder().decode(await client.getBlob(exchanged!.sha))).toBe(
        'next local sample'
      )
      expect(await state.getMeta(`pull-write:${created.file_id}`)).toBeNull()
      expect(new TextDecoder().decode(await app.vault.adapter.readBinary('Shared/a.bin'))).toBe(
        'independent local sample'
      )
      expect(engine.status.state).toBe('idle')
      expect(await app.vault.adapter.stat('Shared/a.bin')).toEqual(originalStat)
      expect(writes.mock.calls.some(([path]) => path === 'Shared/a.bin')).toBe(false)
      expect(
        renames.mock.calls.some(([from, to]) => from === 'Shared/a.bin' || to === 'Shared/a.bin')
      ).toBe(false)
    } finally {
      await engine?.stop()
      debug.mockRestore()
      await server.close()
    }
  }
)
