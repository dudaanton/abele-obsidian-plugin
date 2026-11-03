// @vitest-environment node
import '../helpers/desktopRequire'
import { expect, it } from 'vitest'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryStateStore, SyncEngine, V2EngineClient } from '@abele/sync-sdk/core'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'
import { selectiveFrom } from '@/sync/connection'
import { nativeVault } from '../helpers/nativeRestartVault'
import { settleSyncPeers } from '../e2e/helpers/syncQuiescence'

it('retires a renamed directory after its last remotely deleted child', async () => {
  const server = await v2Server()
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-directory-delete-')))
  const engines: SyncEngine[] = []
  try {
    const user = await createUser(
      { db: server.db, pepper: server.config.tokenPepper },
      'Sample user',
      server.address
    )
    for (const name of ['primary', 'peer']) {
      const home = join(root, name)
      await disk.mkdir(join(home, 'Sample'), { recursive: true })
      const app = nativeVault(home, disk)
      const files = new ObsidianFileSystem(app as never, {
        fileScope: 'Sample',
        journalOwner: name,
        connectionId: name,
        preserveEmptyDirectories: true,
      })
      engines.push(
        new SyncEngine({
          fs: coordinatedFileSystem(files, new PathCoordinator()),
          state: new MemoryStateStore(),
          client: new V2EngineClient(user.token, { fetch: globalThis.fetch }),
          selective: selectiveFrom(undefined),
          log: (message) => console.debug('[sample directory exchange]', name, message),
        })
      )
    }
    const cycle = () =>
      settleSyncPeers(
        async () =>
          (await new V2EngineClient(user.token, { fetch: globalThis.fetch }).state()).head_seq,
        engines.map((engine) => () => engine.sync())
      )
    await disk.mkdir(join(root, 'primary/Sample/from'))
    await disk.writeFile(join(root, 'primary/Sample/from/sample.md'), 'sample')
    await cycle()
    await disk.rename(join(root, 'peer/Sample/from'), join(root, 'peer/Sample/to'))
    await cycle()
    expect(await disk.readFile(join(root, 'primary/Sample/to/sample.md'), 'utf8')).toBe('sample')
    await disk.rm(join(root, 'peer/Sample/to'), { recursive: true })
    await cycle()
    expect(await disk.stat(join(root, 'primary/Sample/to')).catch(() => null)).toBeNull()
    expect(await disk.stat(join(root, 'primary/Sample/from')).catch(() => null)).toBeNull()
  } finally {
    for (const engine of engines) await engine.stop()
    await server.close()
    await disk.rm(root, { recursive: true, force: true })
  }
})
