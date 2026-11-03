import { afterEach, expect, it, vi } from 'vitest'
import {
  settleStoppedInstallationsForDeletion,
  requireExternalEnrollmentSafety,
} from '@/sync/external/pluginSafety'
import { finishRetainedWrites } from '@/sync/privateRecovery'
import {
  connectionAdapter,
  connectionInspectionApp,
  connectionJournalApp,
} from '@/sync/vaultPathLinks'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { WriteJournal } from '@/sync/writeJournal'
import { buildFakeVault } from '../helpers/fakeVault'
import { IDBFactory } from 'fake-indexeddb'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { stagingDirectory } from '@/sync/stagingDirectory'
import { makeParents } from '@/sync/vaultFolders'

afterEach(() => vi.restoreAllMocks())

it('does not grant a scoped view access to a legacy retained receipt', async () => {
  const app = buildFakeVault([]),
    owner = 'sample-scoped',
    root = connectionPrivateRoot(owner)
  const view = connectionInspectionApp(
    connectionJournalApp(app as never, owner),
    app.vault.adapter,
    'Shared',
    root
  )
  const temp =
    app.vault.configDir + '/plugins/abele/sync-recovery/.abele-receipt-sample-foreign.tmp'
  await makeParents(app.vault.adapter, temp)
  await app.vault.adapter.write(temp, 'kept private bytes')
  const journal = new WriteJournal(view, undefined, owner)
  await journal.persist(() =>
    journal.add({
      target: 'Shared/sample.md',
      temp,
      conditionalReceipt: 'sample-foreign',
      retiredGeneration: 'server-deletion',
    })
  )
  await expect(finishRetainedWrites(view, owner)).rejects.toThrow('outside this connection')
  expect(await journal.currentEntries()).toHaveLength(1)
  expect(await app.vault.adapter.read(temp)).toBe('kept private bytes')
})

it.each([false, true])(
  'finishes whole-vault legacy receipts after retirement cut=%s',
  async (cut) => {
    const app = buildFakeVault([]),
      owner = 'sample-whole-vault'
    const view = connectionJournalApp(app as never, owner)
    const temp = stagingDirectory(app.vault.configDir) + '/.abele-receipt-sample-whole.tmp'
    await makeParents(app.vault.adapter, temp)
    await app.vault.adapter.write(temp, 'incoming whole-vault bytes')
    const journal = new WriteJournal(view, undefined, owner)
    await journal.persist(() =>
      journal.add({
        target: 'Shared/sample.md',
        temp,
        conditionalReceipt: 'sample-whole',
        replacementSha: 'a'.repeat(64),
      })
    )
    if (cut) {
      const replace = WriteJournal.prototype.replace
      const failure = new Error('sample cut after retirement marker')
      const hook = vi.spyOn(WriteJournal.prototype, 'replace').mockImplementationOnce(function (
        this: WriteJournal,
        before,
        after
      ) {
        replace.call(this, before, after)
        throw failure
      })
      await expect(settleStoppedInstallationsForDeletion(view, () => {})).rejects.toBe(failure)
      hook.mockRestore()
    } else await settleStoppedInstallationsForDeletion(view, () => {})
    await finishRetainedWrites(app as never)
    expect(await journal.currentEntries()).toEqual([])
    const [kept] = await journal.currentRecovered()
    expect(kept.backup).toBe(
      app.vault.configDir + '/plugins/abele/sync-recovery/.abele-receipt-sample-whole.tmp'
    )
    expect(kept.archived).toBe(true)
    expect(await app.vault.adapter.read(kept.backup)).toBe('incoming whole-vault bytes')
    await expect(requireExternalEnrollmentSafety(app as never)).resolves.toBeUndefined()
  }
)

it.each([false, true])(
  'settles a real first-download receipt interrupted by departure (scoped=%s)',
  async (scoped) => {
    const app = buildFakeVault([]),
      owner = 'sample-interrupted',
      root = connectionPrivateRoot(owner)
    const view = scoped
      ? connectionInspectionApp(
          connectionJournalApp(app as never, owner),
          connectionAdapter(app.vault.adapter, 'Shared', root),
          'Shared',
          root
        )
      : connectionJournalApp(app as never, owner)
    const options = { connectionId: scoped ? owner : undefined, journalOwner: owner }
    const fs = new ObsidianFileSystem(view, options)
    const rename = app.vault.adapter.rename.bind(app.vault.adapter)
    const stopped = new Error('sample stopped before publication')
    const hook = vi.spyOn(app.vault.adapter, 'rename').mockImplementation(async (from, to) => {
      if (to === 'Shared/sample.md') throw stopped
      await rename(from, to)
    })
    await expect(
      fs.conditionalFile({
        path: 'Shared/sample.md',
        expected: null,
        effect: {
          kind: 'write',
          bytes: new TextEncoder().encode('incoming server bytes'),
          mtime: 1000,
          receipt: 'sample-download',
        },
      })
    ).rejects.toThrow('sample stopped before publication')
    hook.mockRestore()
    const journal = new WriteJournal(view, undefined, owner)
    expect(await journal.currentEntries()).toEqual([
      expect.objectContaining({
        conditionalReceipt: 'sample-download',
        target: 'Shared/sample.md',
      }),
    ])
    await settleStoppedInstallationsForDeletion(view, () => {})
    await new ObsidianFileSystem(view, options).recover()
    await expect(requireExternalEnrollmentSafety(app as never)).resolves.toBeUndefined()
    expect(await journal.currentEntries()).toEqual([])
    const [saved] = await journal.currentRecovered()
    expect(saved.archived).toBe(true)
    expect(await app.vault.adapter.read(saved.backup)).toBe('incoming server bytes')
    expect(await app.vault.adapter.exists('Shared/sample.md')).toBe(false)
  }
)

it.each([
  { lost: false, published: false },
  { lost: true, published: false },
  { lost: false, published: true },
])(
  'preserves a drained receipt and its locator before departure (lost=$lost, published=$published)',
  async ({ lost, published }) => {
    const app = buildFakeVault([{ path: 'Shared/kept.md', content: 'local bytes' }])
    const owner = 'sample-connection',
      privateRoot = connectionPrivateRoot(owner)
    const view = connectionInspectionApp(
      connectionJournalApp(app as never, owner),
      connectionAdapter(app.vault.adapter, 'Shared', privateRoot),
      'Shared',
      privateRoot
    )
    const journal = new WriteJournal(view, undefined, owner)
    const temp = privateRoot + '/writes/.abele-receipt-sample-receipt.tmp'
    for (const path of [
      '.abele-sync',
      '.abele-sync/connections',
      privateRoot,
      privateRoot + '/writes',
    ])
      await app.vault.adapter.mkdir(path)
    await app.vault.adapter.write(temp, 'unpublished incoming bytes')
    await journal.persist(() =>
      journal.add({
        target: 'Shared/incoming.md',
        temp,
        conditionalReceipt: 'sample-receipt',
        replacementSha: 'a'.repeat(64),
      })
    )
    const foreign = new WriteJournal(app, undefined, 'other-connection')
    await foreign.persist(() =>
      foreign.add({
        target: 'Elsewhere/kept.md',
        temp: '.abele-sync/connections/other-connection/writes/.abele-receipt-other.tmp',
        conditionalReceipt: 'other',
        replacementSha: 'b'.repeat(64),
      })
    )
    if (published) await app.vault.adapter.rename(temp, 'Shared/incoming.md')
    const rename = app.vault.adapter.rename.bind(app.vault.adapter)
    let cut = lost
    app.vault.adapter.rename = async (from, to) => {
      await rename(from, to)
      if (cut && from === temp) {
        cut = false
        throw new Error('sample acknowledgement lost')
      }
    }
    if (lost)
      await expect(settleStoppedInstallationsForDeletion(view, () => {})).rejects.toThrow(
        'sample acknowledgement lost'
      )
    await settleStoppedInstallationsForDeletion(view, () => {})
    const entries = await journal.currentEntries()
    // Completed preservation no longer belongs in the active installation journal.
    // Its durable archive owner retains the same locator and all incoming bytes.
    expect(entries).toEqual([])
    const kept = await journal.currentRecovered()
    expect(kept).toHaveLength(published ? 0 : 1)
    if (!published)
      expect(kept[0]).toMatchObject({
        target: 'Shared/incoming.md',
        archived: true,
        backup: privateRoot + '/recovery/.abele-receipt-sample-receipt.tmp',
      })
    expect(await app.vault.adapter.read(published ? 'Shared/incoming.md' : kept[0].backup)).toBe(
      'unpublished incoming bytes'
    )
    expect(await app.vault.adapter.exists(temp)).toBe(false)
    expect(await app.vault.adapter.exists('Shared/incoming.md')).toBe(published)
    expect(await app.vault.adapter.read('Shared/kept.md')).toBe('local bytes')
    expect(await foreign.currentEntries()).toHaveLength(1)
    expect((await foreign.currentEntries())[0].retiredGeneration).toBeUndefined()
  }
)

it.each(
  (['none', 'preserve', 'replaceRecovered', 'drop'] as const).flatMap((cut) =>
    [false, true].map((durable) => ({ cut, durable }))
  )
)(
  'finishes a deleted-folder installation before enrollment across a cut at $cut (durable=$durable)',
  async ({ cut, durable }) => {
    const app = buildFakeVault([])
    const factory = new IDBFactory()
    let host = durable ? await HostSyncStorage.open(factory, 'sample-departure', app) : undefined
    try {
      const owner = 'sample-departing',
        root = connectionPrivateRoot(owner)
      const view = connectionInspectionApp(
        connectionJournalApp(app as never, owner),
        connectionAdapter(app.vault.adapter, 'Shared', root),
        'Shared',
        root
      )
      const temp = root + '/writes/.abele-receipt-sample-in-flight.tmp'
      for (const path of ['.abele-sync', '.abele-sync/connections', root, root + '/writes'])
        await app.vault.adapter.mkdir(path)
      await app.vault.adapter.write(temp, 'in-flight server bytes')
      const journal = new WriteJournal(view, undefined, owner)
      await journal.persist(() =>
        journal.add({
          target: 'Shared/sample.md',
          temp,
          conditionalReceipt: 'sample-in-flight',
          replacementSha: 'a'.repeat(64),
        })
      )
      const failure = new Error('sample departure cut')
      const implementation = cut === 'none' ? undefined : WriteJournal.prototype[cut]
      const hook = cut === 'none' ? undefined : vi.spyOn(WriteJournal.prototype, cut)
      if (hook) {
        // The spy above retains the real implementation; cut after the mutation,
        // so relaunch must handle both old and new ownership records together.
        hook.mockImplementationOnce(function (this: WriteJournal, ...args: unknown[]) {
          const result = Reflect.apply(implementation!, this, args)
          if (result instanceof Promise)
            return result.then(() => {
              throw failure
            })
          throw failure
        } as never)
        await expect(settleStoppedInstallationsForDeletion(view, () => {})).rejects.toBe(failure)
        hook.mockRestore()
        if (host) {
          host.close()
          host = await HostSyncStorage.open(factory, 'sample-departure', app)
        }
        await finishRetainedWrites(view, owner)
      } else await settleStoppedInstallationsForDeletion(view, () => {})
      await expect(requireExternalEnrollmentSafety(app as never)).resolves.toBeUndefined()
      expect(await journal.currentEntries()).toEqual([])
      const [kept] = await journal.currentRecovered()
      expect(kept).toMatchObject({ target: 'Shared/sample.md', archived: true })
      expect(await app.vault.adapter.read(kept.backup)).toBe('in-flight server bytes')
      await finishRetainedWrites(view, owner)
      expect(await journal.currentRecovered()).toEqual([kept])
    } finally {
      host?.close()
    }
  }
)

it.each(['missing', 'changed', 'active'] as const)(
  'does not retire %s installation evidence during startup',
  async (kind) => {
    const app = buildFakeVault([]),
      owner = 'sample-recovery',
      root = connectionPrivateRoot(owner)
    const path = root + '/recovery/.abele-receipt-sample-stale.tmp'
    const view = connectionInspectionApp(
      connectionJournalApp(app as never, owner),
      app.vault.adapter,
      '',
      root
    )
    const journal = new WriteJournal(view, undefined, owner)
    for (const folder of ['.abele-sync', '.abele-sync/connections', root, root + '/recovery'])
      await app.vault.adapter.mkdir(folder)
    if (kind !== 'missing') await app.vault.adapter.write(path, 'retained incoming bytes')
    const entry = {
      target: 'Shared/sample.md',
      temp: path,
      conditionalReceipt: 'sample-stale',
      ...(kind === 'active' ? {} : { retiredGeneration: 'server-deletion' }),
    }
    await journal.persist(() => journal.add(entry))
    if (kind === 'changed') {
      await journal.persist(() => journal.preserve({ ...entry, backup: path }))
      const [saved] = await journal.currentRecovered()
      await journal.replaceRecovered(saved, {
        ...saved,
        archive: { path, size: 1, sha: 'b'.repeat(64) },
        archived: true,
      })
    }
    if (kind === 'active') await finishRetainedWrites(view, owner)
    else await expect(finishRetainedWrites(view, owner)).rejects.toThrow()
    expect(await journal.currentEntries()).toHaveLength(1)
    await expect(requireExternalEnrollmentSafety(app as never)).rejects.toThrow(
      'recovery is unfinished'
    )
    if (kind !== 'missing')
      expect(await app.vault.adapter.read(path)).toBe('retained incoming bytes')
  }
)
