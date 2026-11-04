import { expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { MemoryStateStore, sha256 } from '@abele/sync-sdk/core'
import { VaultWriter, type WriterDeps } from '@/sync/vaultWrites'
import { WriteJournal, JOURNAL_KEY, type JournalEntry } from '@/sync/writeJournal'
import { HostSyncStorage } from '@/sync/hostSyncStorage'
import { IndexedDbStateStore } from '@/sync/IndexedDbStateStore'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { checkedVaultPort, guardedVaultAdapter } from '@/sync/vaultPathLinks'
import { buildFakeVault, type FakeApp } from '../helpers/fakeVault'

const payload = new TextEncoder().encode('sample incoming bytes')
const target = 'sample.bin'
it('leaves SDK-owned installation receipts for explicit retirement after ledger acknowledgement', async () => {
  const app = buildFakeVault([]),
    storage = local(),
    ledger = new MemoryStateStore(),
    receipt = 'sample',
    temp = '.obsidian/plugins/abele/sync-staging/.abele-receipt-sample.tmp',
    replacementSha = await sha256(payload),
    journal = new WriteJournal(storage),
    entry = { target, temp, conditionalReceipt: receipt, replacementSha }
  // A portable publication consumed its stage by rename. Its SDK receipt still
  // owns settlement; a matching ledger row is not permission to retire it early.
  await app.vault.adapter.writeBinary(target, payload.buffer)
  await journal.persist(() => journal.add(entry))
  const port = new ObsidianFileSystem(app as never, { storage, ledger })
  const stat = vi.spyOn(app.vault.adapter, 'stat')
  await port.acknowledgeWrites([
    { path: target, sha: replacementSha, size: payload.length, mtime: 1000 },
  ])
  expect(await journal.currentEntries()).toEqual([entry])
  expect(stat).not.toHaveBeenCalled()
  await port.discardInstallation(receipt)
  expect(await journal.currentEntries()).toEqual([])
  expect(new Uint8Array(await app.vault.adapter.readBinary(target))).toEqual(payload)
})

it.each([true, false])(
  'preserves unproven equal-byte anonymous occupants (native=%s)',
  async (native) => {
    const app = buildFakeVault([]),
      temp = '.staging/.abele-receipt-sample.tmp'
    await app.vault.adapter.mkdir('.staging')
    await app.vault.adapter.writeBinary(temp, payload.buffer)
    await app.vault.adapter.writeBinary(target, payload.buffer)
    const journal = new WriteJournal(app)
    const replacementSha = await sha256(payload)
    await journal.persist(() => journal.add({ target, temp, replacementSha }))
    const syncPath = vi.fn(async () => {})
    const writer = new VaultWriter({
      journal,
      filesystem: app.vault.adapter as never,
      stagingDirectory: '.staging',
      retainInstalled: true,
      native: native ? ({ sameObject: async () => false, syncPath } as never) : null,
      indexed: () => false,
      makeParents: async () => {},
      conditionalFile: async () => false,
    })
    await writer.recover()
    expect(await journal.currentEntries()).toHaveLength(1)
    expect(await app.vault.adapter.readBinary(temp)).toEqual(payload.buffer)
    expect(await app.vault.adapter.readBinary(target)).toEqual(payload.buffer)
    expect(syncPath).not.toHaveBeenCalled()
  }
)
function local() {
  const values = new Map<string, unknown>()
  return {
    values,
    loadLocalStorage: (key: string) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key: string, value: unknown) => {
      values.set(key, structuredClone(value))
    },
  }
}
async function restartDisk(app: FakeApp) {
  const next = buildFakeVault([])
  const copy = async (folder: string) => {
    const listed = await app.vault.adapter.list(folder)
    for (const child of listed.folders) {
      await next.vault.adapter.mkdir(child)
      await copy(child)
    }
    for (const path of listed.files)
      await next.vault.adapter.writeBinary(
        path,
        await app.vault.adapter.readBinary(path),
        (await app.vault.adapter.stat(path)) ?? undefined
      )
  }
  await copy('')
  return next
}

it.each([true, false])(
  'keeps anonymous publication evidence across every post-install boundary (native=%s)',
  async (native) => {
    const exercise = async (cut?: number) => {
      const factory = new IDBFactory(),
        storage = local()
      let app = buildFakeVault([])
      let host = await HostSyncStorage.open(factory, 'sample-host', storage)
      const trace: string[] = []
      const crash = new Error('simulated process exit')
      let installed = false,
        stopped = false,
        measuring = true
      const checkpoint = (label: string) => {
        if (!measuring || !installed) return
        trace.push(label)
        if (cut === trace.length) {
          stopped = true
          throw crash
        }
      }
      const identities = new Map<string, number>()
      let sequence = 0
      const identity = (path: string) => {
        if (!identities.has(path)) identities.set(path, ++sequence)
        return identities.get(path)
      }
      const makeWriter = (faults: boolean) => {
        const adapter = app.vault.adapter
        const stat = adapter.stat.bind(adapter),
          remove = adapter.remove.bind(adapter)
        if (faults) {
          adapter.stat = async (path) => {
            const value = await stat(path)
            checkpoint('stat ' + path)
            return value
          }
          adapter.remove = async (path) => {
            await remove(path)
            identities.delete(path)
            checkpoint('remove alias')
          }
        }
        const disk = guardedVaultAdapter(adapter as never)
        const checked = checkedVaultPort(app.vault as never, disk, {
          ready() {},
          effect: (work) => work(),
        })
        const rename = adapter.rename
        if (faults)
          adapter.rename = async function (from, to) {
            await rename.call(this, from, to)
            if (to === target) {
              installed = true
              checkpoint('checked rename')
            }
          }
        const deps: WriterDeps = {
          journal: new WriteJournal(storage),
          filesystem: adapter as never,
          stagingDirectory: '.staging',
          retainInstalled: true,
          indexed: () => false,
          conditionalFile: async () => false,
          makeParents: async (path) => {
            const parent = path.slice(0, Math.max(0, path.lastIndexOf('/')))
            if (parent) await adapter.mkdir(parent)
          },
          installed: () => checkpoint('installed callback'),
          published: () => checkpoint('published callback'),
          native: native
            ? ({
                installExclusive: async (from: string, to: string) => {
                  if (await adapter.exists(to))
                    throw Object.assign(new Error('occupied'), { code: 'EEXIST' })
                  await adapter.writeBinary(to, await adapter.readBinary(from))
                  identities.set(to, identity(from)!)
                  installed = true
                  checkpoint('exclusive install')
                },
                sameObject: async (a: string, b: string) =>
                  !!(await stat(a)) && !!(await stat(b)) && identity(a) === identity(b),
                syncPath: async (path: string, parentsOnly?: boolean) => {
                  checkpoint('sync ' + path + ':' + !!parentsOnly)
                },
              } as never)
            : null,
          createAbsent: async (path, bytes, mtime, temp) => {
            await disk.writeBinary(temp, bytes.slice().buffer, { mtime })
            await checked.wait(path)
            const release = await checked.acquire([path])
            try {
              await release.wait(disk.rename(temp, path))
              release.check()
            } finally {
              release()
            }
            checkpoint('checked acknowledgement')
          },
        }
        const writer = new VaultWriter(deps)
        if (faults) {
          const finish = Reflect.get(writer, 'finishAnonymous').bind(writer)
          Reflect.set(writer, 'finishAnonymous', async (entry: JournalEntry) => {
            await finish(entry)
            checkpoint('finish acknowledgement')
          })
        }
        return writer
      }
      const journal = () => new WriteJournal(storage)
      let state: IndexedDbStateStore | undefined
      try {
        const writing = makeWriter(true).publishAbsent(target, payload, 1000)
        if (cut === undefined) {
          expect(await writing).toBe(true)
          return trace
        }
        let failure: unknown = await writing.then(
          () => undefined,
          (error: unknown) => error
        )
        while (failure instanceof Error && failure.cause) failure = failure.cause
        expect(failure).toBe(crash)
        expect(stopped).toBe(true)
        measuring = false
        expect(await journal().currentEntries()).toHaveLength(1)
        host.close()
        storage.values.clear()
        app = await restartDisk(app)
        host = await HostSyncStorage.open(factory, 'sample-host', storage)
        state = await IndexedDbStateStore.open(factory, 'sample-ledger')
        const writer = makeWriter(false)
        await writer.recover()
        await writer.recover()
        expect(await journal().currentEntries(), trace.join('\n')).toHaveLength(1)
        expect(new Uint8Array(await app.vault.adapter.readBinary(target))).toEqual(payload)
        const port = new ObsidianFileSystem(app as never, { storage, ledger: state })
        state.observeCommittedEntries((entries) => port.acknowledgeWrites(entries))
        const row = {
          path: target,
          wirePath: target,
          fileId: 'sample-file',
          versionId: 'sample-version',
          sha: await sha256(payload),
          size: payload.length,
          mtime: 1000,
        }
        await expect(
          state.transaction(async (tx) => {
            await tx.put(row)
            await writer.recover()
            expect(await journal().currentEntries()).toHaveLength(1)
            throw new Error('rollback')
          })
        ).rejects.toThrow('rollback')
        const changes = vi.spyOn(host, 'changeRecords')
        await state.put(row)
        await state.put(row)
        await writer.recover()
        expect(await journal().currentEntries()).toEqual([])
        expect(
          changes.mock.calls
            .flatMap(([batch]) => batch)
            .filter((change) => change.key === JOURNAL_KEY && change.after === undefined)
        ).toHaveLength(1)
        expect(new Uint8Array(await app.vault.adapter.readBinary(target))).toEqual(payload)
      } finally {
        state?.close()
        host.close()
      }
      return trace
    }
    const trace = await exercise()
    expect(trace.length).toBeGreaterThan(3)
    for (let cut = 1; cut <= trace.length; cut++) await exercise(cut)
    console.debug('[anonymous publication crash boundaries]', { native, boundaries: trace.length })
  }
)
