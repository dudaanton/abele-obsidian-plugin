// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  ExpectedWrites,
  MemoryFileSystem,
  MemoryStateStore,
  SyncEngine,
  V2EngineClient,
  scan,
  push,
} from '@abele/sync-sdk/core'
import { scanSnapshot } from '../../node_modules/@abele/sync-sdk/dist/internal/core/scanSnapshot.js'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { defaultSelective } from '@/sync/connection'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'

it.each(['enumeration', 'after-scan', 'after-upload'] as const)(
  'does not publish a deletion for a file restored during %s',
  async (cut) => {
    const server = await v2Server()
    const fs = new MemoryFileSystem(),
      state = new MemoryStateStore()
    let engine: SyncEngine | undefined
    try {
      const user = await createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
      const client = new V2EngineClient(user.token, { fetch: globalThis.fetch })
      const bytes = new TextEncoder().encode('sample retained bytes')
      const restore = () => fs.writeAtomic('sample.md', bytes, 1000)
      await restore()
      engine = new SyncEngine({ fs, state, client, selective: defaultSelective() })
      await engine.sync()
      await fs.remove('sample.md')
      let revision = 0,
        restored = false
      const list = fs.list.bind(fs)
      Reflect.set(fs, Symbol.for('abele.sync.local-scan-revision-v1'), () => revision)
      if (cut === 'enumeration')
        fs.list = async function* () {
          yield* list()
          if (!restored) {
            restored = true
            await restore()
            revision++
          }
        }
      if (cut === 'after-upload')
        await fs.writeAtomic('other.md', new TextEncoder().encode('sample upload bytes'), 1000)
      const options = { yieldTask: async () => {}, allowConcurrentChanges: true }
      const inventory = scanSnapshot(fs, () => undefined, options)
      const found = await scan(inventory.fs, state, { excluded: () => false })
      if (cut === 'enumeration') {
        expect(Reflect.get(inventory, 'changed')()).toBe(true)
        expect(found.complete).toBe(false)
      } else
        expect(found.ops).toEqual(
          expect.arrayContaining([expect.objectContaining({ op: 'delete' })])
        )
      if (cut === 'after-scan') await restore()
      if (cut === 'after-upload') {
        const upload = client.putBlobSource.bind(client)
        vi.spyOn(client, 'putBlobSource').mockImplementation(async (...args) => {
          await upload(...args)
          await restore()
          restored = true
        })
        const putBlob = client.putBlob.bind(client)
        vi.spyOn(client, 'putBlob').mockImplementation(async (...args) => {
          await putBlob(...args)
          await restore()
          restored = true
        })
      }
      const commit = vi.spyOn(client, 'commitRaw')
      await push(client, fs, state, found, { expected: new ExpectedWrites() })
      if (cut === 'after-upload') expect(restored).toBe(true)
      expect(commit.mock.calls.flatMap(([ops]) => ops).filter((op) => op.op === 'delete')).toEqual(
        []
      )
      expect((await client.manifest(null)).items).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'sample.md' })])
      )
      expect(await fs.read('sample.md')).toEqual(bytes)
    } finally {
      await engine?.stop()
      await server.close()
    }
  }
)

it('confirms absence against disk despite a cached missing observation or a folder replacement', async () => {
  const app = buildFakeVault([])
  const fs = new ObsidianFileSystem(app as never)
  const confirm = Reflect.get(fs, Symbol.for('abele.sync.confirm-missing-v1')).bind(fs)
  await Reflect.get(fs, Symbol.for('abele.sync.inventory-pass-v1')).call(fs, async () => {
    expect(await fs.stat('sample.md')).toBeNull()
    expect(await confirm('sample.md')).toBe(true)
    await app.vault.adapter.writeBinary(
      'sample.md',
      new TextEncoder().encode('sample restored bytes').buffer
    )
    expect(await confirm('sample.md')).toBe(false)
    await app.vault.adapter.remove('sample.md')
    await app.vault.adapter.mkdir('sample.md')
    expect(await confirm('sample.md')).toBe(false)
  })
})
