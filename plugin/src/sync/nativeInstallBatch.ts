import {
  EngineError,
  MAX_CHUNK_BYTES,
  type AtomicStage,
  type FileSystem,
} from '@abele/sync-sdk/core'
import type { DataAdapter } from 'obsidian'
import type { BoundedVaultIo } from './boundedVaultIo'
import type { NativeFs } from './nativeVaultFs'
import type { WriteJournal, JournalEntry } from './writeJournal'
import { reserveSourceStage, releaseSourceStage } from './vaultWrites'

export const INSTALL_BATCH = Symbol.for('abele.sync.install-batch-v1')
export interface InstallItem {
  path: string
  size: number
  sha: string
  mtime: number
}
export interface InstallBatchHost {
  fs: FileSystem
  disk: DataAdapter
  native: NativeFs
  io: BoundedVaultIo
  journal: WriteJournal
  freeName(path: string): Promise<string>
  ownsStage(path: string): boolean
  assertReady(): void
  validate(path: string): void
  parents(path: string): Promise<void>
  publish(from: string, to: string, signal?: AbortSignal): Promise<void>
  installed(item: InstallItem): void
}

/** Fresh destinations only. The callback must flush namespaces BEFORE its outer ledger
 * commit. Private aliases and the independent host intent survive until that commit.
 * No replacement, deletion or adoption authority is granted by this capability. */
export async function nativeInstallBatch<T>(
  host: InstallBatchHost,
  items: readonly InstallItem[],
  work: (fs: FileSystem, flush: () => Promise<void>) => Promise<T>
): Promise<T | undefined> {
  const { native, journal, disk, io } = host
  if (
    !native.syncFile ||
    !native.syncPath ||
    !native.installExclusive ||
    !native.sameObject ||
    !items.length ||
    items.length > 64 ||
    (items.length > 1 && items.reduce((total, item) => total + item.size, 0) > 16 * 1024 * 1024)
  )
    return undefined
  const plans = new Map<
    string,
    {
      item: InstallItem
      entry: JournalEntry
      previous?: JournalEntry
      offset: number
      sealed: boolean
      created: boolean
      allocated: boolean
      published: boolean
      /** Publication was attempted; a lost acknowledgement may still have placed the name. */
      publishing: boolean
      discarded: boolean
    }
  >()
  try {
    const prior = await journal.currentForTargets(items.map((item) => item.path))
    // A new single-chunk file has nothing to amortize. Keep its ordinary
    // publication/diagnostic lifetime; cache recovery and multi-chunk files
    // still benefit even when they are the only remaining destination.
    if (items.length === 1 && items[0].size <= MAX_CHUNK_BYTES && !prior.length) return undefined
    for (const item of items) {
      host.validate(item.path)
      if (plans.has(item.path)) return undefined
      if ((await host.fs.stat(item.path)) !== null) return undefined
      const existing = prior.filter((entry) => entry.target === item.path)
      const cache = (entry: JournalEntry) =>
        entry.disposableSource &&
        !entry.backup &&
        !entry.retiredGeneration &&
        entry.streaming?.base === null &&
        !entry.streaming.retainBase &&
        !entry.streaming.retainedBackup &&
        !!entry.temp &&
        host.ownsStage(entry.temp)
      if (existing.some((entry) => !cache(entry))) return undefined
      let previous: JournalEntry | undefined
      for (const entry of existing) {
        if (entry.replacementSha !== item.sha || !(await disk.stat(entry.temp))) continue
        const identity = await io.fingerprint(entry.temp, undefined, true)
        if (identity.sha === item.sha && identity.size === item.size) {
          previous = entry
          break
        }
      }
      const temp = previous?.temp ?? (await host.freeName(item.path))
      if ([...plans.values()].some((plan) => plan.entry.temp === temp)) return undefined
      plans.set(item.path, {
        item,
        previous,
        entry: {
          ...previous,
          target: item.path,
          temp,
          replacementSha: item.sha,
          disposableSource: true,
          streaming: { mtime: item.mtime, base: null },
        },
        offset: previous ? item.size : 0,
        sealed: false,
        created: !!previous,
        allocated: false,
        published: false,
        publishing: false,
        discarded: false,
      })
    }
  } catch (error) {
    console.debug('[abele-sync] batch preflight unavailable; using ordinary placement', error)
    return undefined
  }
  host.assertReady()
  for (const plan of plans.values()) reserveSourceStage(plan.entry.temp)
  let active = true
  const check = () => {
    if (!active) throw new EngineError('conflict', 'installation batch has expired')
    host.assertReady()
  }
  const byId = (id: string) => {
    check()
    const plan = [...plans.values()].find((plan) => plan.entry.temp === id)
    if (!plan) throw new EngineError('conflict', 'stage is outside the installation batch')
    return plan
  }
  try {
    // One independently durable ownership batch, before the first artifact exists.
    await journal.persist(() => {
      for (const plan of plans.values()) {
        if (plan.previous) journal.replace(plan.previous, plan.entry)
        else journal.add(plan.entry)
      }
    })
    const view = new Proxy(host.fs, {
      get(target, key) {
        if (key === INSTALL_BATCH || key === 'conditionalFile') return undefined
        if (key === Symbol.for('abele.sync.replay-stage-v1')) return async () => false
        if (key === 'discardStage')
          return async (id: string) => {
            byId(id).discarded = true
          }
        if (key === 'beginAtomicWrite')
          return async (
            path: string,
            mtime: number,
            base: unknown,
            beforeCreate?: (id: string) => Promise<void>
          ): Promise<AtomicStage> => {
            check()
            const plan = plans.get(path)
            if (!plan || base !== null || mtime !== plan.item.mtime || plan.allocated)
              throw new EngineError('conflict', 'unexpected batch installation')
            plan.allocated = true
            const id = plan.entry.temp
            await beforeCreate?.(id)
            // Destination folders are created at publication. A download interrupted or
            // paused before then leaves no new vault folder and needs no barrier.
            await host.parents(id)
            check()
            if (plan.previous) {
              await io.append(id, plan.offset, new Uint8Array(), mtime, undefined, 'deferred')
              console.debug('[abele-sync] reusing verified download stage', path)
            } else await io.create(id, mtime, 'deferred')
            plan.created = true
            return {
              id,
              get offset() {
                return plan.offset
              },
              append: async (offset, bytes, signal) => {
                check()
                if (plan.sealed || offset !== plan.offset || offset + bytes.length > plan.item.size)
                  throw new EngineError('conflict', 'invalid batch stage offset')
                await io.append(id, offset, bytes, mtime, signal, 'deferred')
                plan.offset += bytes.length
              },
              seal: async (expected) => {
                check()
                const identity = await io.fingerprint(id, undefined, true)
                if (
                  expected.sha !== plan.item.sha ||
                  expected.size !== plan.item.size ||
                  identity.sha !== expected.sha ||
                  identity.size !== expected.size
                )
                  throw new EngineError('protocol', 'batch stage integrity mismatch')
                // Flush the complete inode once, never individual transfer chunks.
                await native.syncFile(id)
                plan.sealed = true
              },
              commit: async (signal) => {
                check()
                signal?.throwIfAborted()
                if (!plan.sealed || plan.published)
                  throw new EngineError('conflict', 'batch stage is not ready')
                await host.parents(path)
                check()
                signal?.throwIfAborted()
                // link is exclusive; even a writer racing the preflight is preserved.
                try {
                  plan.publishing = true
                  await host.publish(id, path, signal)
                } catch (error) {
                  if ((error as { code?: string })?.code === 'EEXIST')
                    throw new EngineError(
                      'conflict',
                      'batch destination changed before publication'
                    )
                  throw error
                }
                plan.published = true
                host.installed(plan.item)
              },
              discard: async () => {
                byId(id).discarded = true
              },
            }
          }
        const value = Reflect.get(target, key)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const result = await work(view, async () => {
      check()
      // All namespace mutations already happened. The dirty-generation tracker
      // shares each affected parent/ancestor barrier across this entire cohort.
      for (const plan of plans.values()) {
        if (!plan.published) throw new EngineError('conflict', 'batch installation was interrupted')
        if (!(await native.sameObject(plan.entry.temp, plan.item.path)))
          throw new EngineError('conflict', 'batch destination changed before ledger commit')
        await native.syncPath(plan.item.path, true)
      }
      // The installed ledger requires durable public names, not private aliases.
      // Their independent cache intents remain owned until retirement below;
      // flush that directory once after removing all acknowledged aliases.
    })
    // Only the SDK's acknowledged cleanup may retire an alias. A failed outer
    // commit never reaches here; its independent intents remain recoverable.
    for (const plan of plans.values()) {
      if (!plan.discarded) continue
      check()
      await disk.remove(plan.entry.temp)
    }
    await native.syncPath(plans.values().next().value!.entry.temp, true)
    await journal.persist(() => {
      for (const plan of plans.values()) if (plan.discarded) journal.drop(plan.entry)
    })
    return result
  } catch (error) {
    // A refused cohort can fall back to ordinary adoption. Make any already
    // published names durable before that path can acknowledge their ledger rows.
    // A failed barrier still escapes: an intact read alone cannot acknowledge it.
    // Unpublished stages are disposable cache owned by the journal; a pause or failure
    // before publication writes and flushes nothing more.
    for (const plan of plans.values())
      if (plan.publishing) await native.syncPath(plan.item.path, true)
    if ([...plans.values()].some((plan) => plan.publishing))
      await native.syncPath(plans.values().next().value!.entry.temp, true)
    const unused = [...plans.values()].filter((plan) => !plan.previous && !plan.allocated)
    if (unused.length)
      await journal.persist(() => {
        for (const plan of unused) journal.drop(plan.entry)
      })
    throw error
  } finally {
    active = false
    for (const plan of plans.values()) releaseSourceStage(plan.entry.temp)
    plans.clear()
  }
}
