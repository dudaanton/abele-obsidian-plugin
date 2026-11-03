// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { MemoryStateStore, SyncEngine, V2EngineClient } from '@abele/sync-sdk/core'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { AttachmentConsent } from '@/sync/attachmentConsent'
import { ExecutableReview } from '@/sync/executableReview'
import { selectiveFrom } from '@/sync/connection'
import { buildFakeVault } from '../helpers/fakeVault'
import { settleSyncPeers } from '../e2e/helpers/syncQuiescence'

it.each([false, true])(
  'publishes one discoverable conflict copy with immediate host capture notification=%s',
  async (notifyCapture) => {
    const win = new Window()
    vi.stubGlobal('window', win)
    vi.stubGlobal('document', win.document)
    const server = await v2Server()
    const engines: { sync(): Promise<unknown>; stop(): Promise<void> }[] = []
    let runtime: TokenEngineRuntime | undefined
    try {
      const user = await createUser(
        { db: server.db, pepper: server.config.tokenPepper },
        'Sample user',
        server.address
      )
      const remote = new ObsidianFileSystem(buildFakeVault([]) as never),
        app = buildFakeVault([])
      if (notifyCapture) {
        const rename = app.vault.adapter.rename.bind(app.vault.adapter)
        app.vault.adapter.rename = async (from, to) => {
          const indexed = app.vault.getFileByPath(from)
          await rename(from, to)
          // The host may move the same indexed object before the adapter's
          // acknowledgement, including moves into an unindexed recovery folder.
          if (indexed && to.endsWith('/victim')) indexed.path = to
        }
      }
      const phone = new ObsidianFileSystem(app as never)
      engines.push(
        new SyncEngine({
          fs: remote,
          state: new MemoryStateStore(),
          client: new V2EngineClient(user.token, { fetch: globalThis.fetch }),
          selective: selectiveFrom(undefined),
        })
      )
      const reviews = new MemoryStateStore()
      runtime = new TokenEngineRuntime({
        id: 'sample-phone',
        encoded: user.token,
        fs: phone,
        state: new MemoryStateStore(),
        selective: selectiveFrom(undefined),
        mobile: true,
        reviews: {
          attachments: new AttachmentConsent(reviews),
          executables: new ExecutableReview(reviews),
          close() {},
        },
        fetch: globalThis.fetch,
        changed() {},
        failed(error) {
          console.debug('[sample portable failure]', error)
        },
        covers: async () => false,
      })
      engines.push({ sync: () => runtime!.sync(), stop: () => runtime!.close() })
      await runtime.start()
      const cycle = () =>
        settleSyncPeers(
          async () =>
            (await new V2EngineClient(user.token, { fetch: globalThis.fetch }).state()).head_seq,
          engines.map((engine) => () => engine.sync())
        )
      await remote.writeAtomic('sample.md', new TextEncoder().encode('baseline\n'), 1)
      await cycle()
      await runtime.pause(true)
      await app.vault.adapter.writeBinary(
        'sample.md',
        new TextEncoder().encode('portable edit\n').buffer,
        { mtime: 2 }
      )
      const watch = Reflect.get(runtime.engine, 'watch')
      watch.notice(['sample.md'])
      await watch.examine()
      await remote.writeAtomic('sample.md', new TextEncoder().encode('remote edit\n'), 3)
      await engines[0].sync()
      await runtime.pause(false)
      await cycle()
      const copies: string[] = []
      for await (const entry of phone.list())
        if (entry.path.includes('(Conflicted copy')) copies.push(entry.path)
      expect(copies).toHaveLength(1)
      expect(
        [await app.vault.adapter.read('sample.md'), await app.vault.adapter.read(copies[0])].sort()
      ).toEqual(['portable edit\n', 'remote edit\n'].sort())
    } finally {
      for (const engine of engines) await engine.stop()
      await server.close()
      await win.happyDOM.close()
      vi.unstubAllGlobals()
    }
  },
  30000
)
