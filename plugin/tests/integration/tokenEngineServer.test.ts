// @vitest-environment node
import { expect, it } from 'vitest'
import { v2Server } from '@abele/sync-server/tests/helpers/v2Server.js'
import { createUser } from '@abele/sync-server/src/access/tokens.js'
import { MemoryStateStore } from '@abele/sync-core'
import type { App } from 'obsidian'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { buildFakeVault } from '../helpers/fakeVault'
import { TokenEngineRuntime } from '@/sync/tokenEngineRuntime'
import { coordinatedFileSystem, PathCoordinator } from '@/sync/pathCoordinator'
import { ExecutableReview } from '@/sync/executableReview'
import { AttachmentConsent } from '@/sync/attachmentConsent'

it('exchanges files through two production token engines, forwards an edit and resumes after restart', async () => {
  const servers = await Promise.all([v2Server(), v2Server()])
  const fs = new ObsidianFileSystem(buildFakeVault([]) as unknown as App, {
      preserveEmptyDirectories: true,
    }),
    locks = new PathCoordinator(),
    requests: string[] = []
  const state = [new MemoryStateStore(), new MemoryStateStore()]
  const metadata = new MemoryStateStore(),
    reviews = {
      executables: new ExecutableReview(metadata),
      attachments: new AttachmentConsent(metadata),
      close: () => {},
    }
  let engines: TokenEngineRuntime[] = []
  const fetchPort: typeof fetch = (input, init) => {
    requests.push(new URL(String(input)).pathname)
    return globalThis.fetch(input, init)
  }
  try {
    const users = await Promise.all(
      servers.map((server) =>
        createUser(
          { db: server.db, pepper: server.config.tokenPepper },
          'Sample user',
          server.address
        )
      )
    )
    const create = () =>
      users.map(
        (user, index) =>
          new TokenEngineRuntime({
            id: 'sample-connection-' + index,
            encoded: user.token,
            fs: coordinatedFileSystem(fs, locks),
            state: state[index],
            reviews,
            fetch: fetchPort,
            changed: () => {},
            failed: () => {},
            covers: async () => true,
          })
      )
    engines = create()
    await fs.writeAtomic('Shared/sample.md', new TextEncoder().encode('one\ntwo\n'), 1000)
    await engines[0].sync()
    await engines[1].sync()
    expect(await state[0].get('Shared/sample.md')).not.toBeNull()
    expect(await state[1].get('Shared/sample.md')).not.toBeNull()
    await fs.writeAtomic('Shared/sample.md', new TextEncoder().encode('ONE\ntwo\n'), 2000)
    await engines[0].sync()
    await engines[1].sync()
    await Promise.all(engines.map((one) => one.disconnect()))
    engines = create()
    await engines[0].sync()
    await engines[1].sync()
    expect(new TextDecoder().decode(await fs.read('Shared/sample.md'))).toBe('ONE\ntwo\n')
    expect((await state[0].get('Shared/sample.md'))?.sha).toBe(
      (await state[1].get('Shared/sample.md'))?.sha
    )
    expect(requests.every((path) => path.startsWith('/v2/'))).toBe(true)
  } finally {
    await Promise.all(engines.map((one) => one.disconnect()))
    await Promise.all(servers.map((one) => one.close()))
  }
})
