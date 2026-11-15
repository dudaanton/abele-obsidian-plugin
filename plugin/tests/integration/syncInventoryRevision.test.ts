// @vitest-environment node
import { expect, it, vi } from 'vitest'
import {
  MemoryFileSystem,
  MemoryStateStore,
  SyncEngine,
  V2EngineClient,
  sha256,
} from '@abele/sync-sdk/core'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { defaultSelective } from '@/sync/connection'

it.each(['revision', 'always', 'remote', 'pause'] as const)(
  'handles an inventory %s during a real sync without confusing revision changes with user stops',
  async (cut) => {
    const server = await v2Server()
    const fs = new MemoryFileSystem()
    let engine: SyncEngine | undefined
    let deadline: ReturnType<typeof setTimeout> | undefined
    try {
      const user = await createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
      const client = new V2EngineClient(user.token, { fetch: globalThis.fetch })
      const logs: string[] = []
      const continuous = cut === 'always' || cut === 'remote'
      let armed = cut !== 'remote'
      if (cut !== 'remote')
        await fs.writeAtomic('sample.md', new TextEncoder().encode('sample revision bytes'), 1000)
      let typed = 'sample typed bytes'
      if (continuous) await fs.writeAtomic('typing.md', new TextEncoder().encode(typed), 1000)
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
        if (armed && observed && (!interrupted || continuous)) {
          interrupted = true
          if (cut === 'pause') engine!.pause()
          else {
            revision++
            if (continuous) {
              typed += '.'
              await fs.writeAtomic('typing.md', new TextEncoder().encode(typed), 1000 + revision)
              if (cut === 'remote' && revision === 1) {
                const entry = (await client.manifest(null)).items.find(
                  (one) => one.path === 'typing.md'
                )!
                const bytes = new TextEncoder().encode('sample remote edit')
                const sha = await sha256(bytes)
                await client.putBlob(sha, bytes)
                await client.commit(
                  [
                    {
                      op: 'modify',
                      file_id: entry.file_id,
                      base_version_id: entry.version_id,
                      sha,
                      size: bytes.length,
                      mtime: 2000,
                    },
                  ],
                  crypto.randomUUID()
                )
              }
            }
          }
        }
      }
      engine = new SyncEngine({
        fs,
        state: new MemoryStateStore(),
        client,
        selective: defaultSelective(),
        log: (message) => logs.push(message),
      })
      if (cut === 'remote') {
        await engine.sync()
        await fs.writeAtomic('sample.md', new TextEncoder().encode('sample revision bytes'), 1000)
        observed = false
        armed = true
      }
      if (cut === 'pause') {
        await expect(engine.sync()).rejects.toThrow('sync stopped')
        expect(engine.status.state).toBe('paused')
        expect(
          logs.filter((message) => message.includes('retrying with a fresh inventory'))
        ).toHaveLength(0)
      } else {
        // Bound a broken implementation too: teardown must not wait forever on
        // an endlessly restarted cycle holding the exclusive scheduler.
        deadline = setTimeout(() => engine!.pause(), 2000)
        const pending = engine.sync()
        const exclusive = engine.runExclusive(async () => 'sample exclusive completed')
        void exclusive.catch(() => {})
        await pending
        expect(await exclusive).toBe('sample exclusive completed')
        expect(engine.status.state).toBe('idle')
        expect(engine.status.lastError).toBeNull()
        expect(
          logs.filter((message) => message.includes('retrying with a fresh inventory'))
        ).toHaveLength(0)
        expect(logs.some((message) => message.includes('retaining unfinished inspection'))).toBe(
          true
        )
        expect((await client.manifest(null)).items).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: 'sample.md' })])
        )
        if (continuous) {
          expect(new TextDecoder().decode(await fs.read('typing.md'))).toBe(typed)
          armed = false
          const latestSha = await sha256(new TextEncoder().encode(typed))
          await vi.waitFor(
            async () => {
              expect((await client.manifest(null)).items).toEqual(
                expect.arrayContaining([expect.objectContaining({ sha: latestSha })])
              )
            },
            { timeout: 1500, interval: 20 }
          )
        }
      }
      expect(interrupted).toBe(true)
    } finally {
      clearTimeout(deadline)
      await engine?.stop()
      await server.close()
    }
  }
)
