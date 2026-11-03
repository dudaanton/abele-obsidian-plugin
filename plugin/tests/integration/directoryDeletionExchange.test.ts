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
import { TokenSyncLive } from '../e2e/helpers/tokenSyncLive'
import { connectionJournalApp } from '@/sync/connectionScope'
import {
  settleStoppedInstallationsForDeletion,
  requireExternalEnrollmentSafety,
} from '@/sync/external/pluginSafety'
import { WriteJournal } from '@/sync/writeJournal'

it.each([
  { name: 'delivers recipient creates and edits through the actual e2e cycle', delivery: true },
  { name: 'retires a renamed directory after its last remotely deleted child', delivery: false },
])('$name', async ({ delivery }) => {
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
    // Exercise the actual e2e round-trip helper and native adapters, rather than
    // supplying a correct head callback which could mask its protocol mistake.
    const cycle = () =>
      TokenSyncLive.prototype.cycle.call({
        client: () => new V2EngineClient(user.token, { fetch: globalThis.fetch }),
        primary: { syncNow: () => engines[0].sync() },
        peer: { syncNow: () => engines[1].sync() },
      } as unknown as TokenSyncLive)
    await disk.mkdir(join(root, 'primary/Sample/from'))
    await disk.writeFile(join(root, 'primary/Sample/from/sample.md'), 'sample')
    await cycle()
    if (delivery) {
      await disk.writeFile(join(root, 'peer/Sample/recipient.md'), 'recipient creates')
      await cycle()
      expect(await disk.readFile(join(root, 'primary/Sample/recipient.md'), 'utf8')).toBe(
        'recipient creates'
      )
      await disk.writeFile(join(root, 'peer/Sample/recipient.md'), 'recipient edits')
      await cycle()
      expect(await disk.readFile(join(root, 'primary/Sample/recipient.md'), 'utf8')).toBe(
        'recipient edits'
      )
      return
    }
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

it('finishes a whole-vault native installation interrupted before its SDK acknowledgement', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-native-departure-')))
  try {
    const app = nativeVault(root, disk),
      owner = 'sample-in-flight'
    const fs = new ObsidianFileSystem(app as never, { journalOwner: owner })
    expect(
      await fs.conditionalFile({
        path: 'Sample/kept.md',
        expected: null,
        effect: {
          kind: 'write',
          bytes: new TextEncoder().encode('native incoming bytes'),
          mtime: 1000,
          receipt: 'sample-native',
        },
      })
    ).toBe(true)
    const view = connectionJournalApp(app as never, owner)
    const journal = new WriteJournal(view, undefined, owner)
    expect(await journal.currentEntries()).toHaveLength(1)
    // Stop before the pull ledger acknowledges this receipt, as departure does
    // during an initial download. Both the public name and private alias exist.
    await settleStoppedInstallationsForDeletion(view, () => {})
    expect(await journal.currentEntries()).toEqual([])
    const [kept] = await journal.currentRecovered()
    expect(kept.archived).toBe(true)
    expect(await disk.readFile(join(root, kept.backup), 'utf8')).toBe('native incoming bytes')
    expect(await disk.readFile(join(root, 'Sample/kept.md'), 'utf8')).toBe('native incoming bytes')
    await new ObsidianFileSystem(app as never, { journalOwner: owner }).recover()
    await expect(requireExternalEnrollmentSafety(app as never)).resolves.toBeUndefined()
  } finally {
    await disk.rm(root, { recursive: true, force: true })
  }
})
