// @vitest-environment node
import { expect, it } from 'vitest'
import {
  MemoryFileSystem,
  MemoryStateStore,
  SyncEngine,
  V2EngineClient,
} from '@abele/sync-sdk/core'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { defaultSelective } from '@/sync/connection'

it.each(['revision', 'pause'] as const)(
  'handles an inventory %s during a real sync without confusing revision changes with user stops',
  async (cut) => {
    const server = await v2Server()
    const fs = new MemoryFileSystem()
    let engine: SyncEngine | undefined
    try {
      const user = await createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
      const client = new V2EngineClient(user.token, { fetch: globalThis.fetch })
      const logs: string[] = []
      await fs.writeAtomic('sample.md', new TextEncoder().encode('sample revision bytes'), 1000)
      let revision = 0,
        observed = false,
        interrupted = false
      Reflect.set(fs, Symbol.for('abele.sync.local-scan-revision-v1'), () => {
        observed = true
        return revision
      })
      const list = fs.list.bind(fs)
      fs.list = async function* () {
        yield* list()
        if (observed && !interrupted) {
          interrupted = true
          if (cut === 'pause') engine!.pause()
          else revision++
        }
      }
      engine = new SyncEngine({
        fs,
        state: new MemoryStateStore(),
        client,
        selective: defaultSelective(),
        log: (message) => logs.push(message),
      })
      if (cut === 'pause') {
        await expect(engine.sync()).rejects.toThrow('sync stopped')
        expect(engine.status.state).toBe('paused')
        expect(
          logs.filter((message) => message.includes('retrying with a fresh inventory'))
        ).toHaveLength(0)
      } else {
        await engine.sync()
        expect(engine.status.state).toBe('idle')
        expect(engine.status.lastError).toBeNull()
        expect(
          logs.filter((message) => message.includes('retrying with a fresh inventory'))
        ).toHaveLength(1)
        expect((await client.manifest(null)).items).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: 'sample.md' })])
        )
      }
      expect(interrupted).toBe(true)
    } finally {
      await engine?.stop()
      await server.close()
    }
  }
)
