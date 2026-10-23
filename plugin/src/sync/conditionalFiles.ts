import { EngineError, sha256 } from '@abele/sync-sdk/core'
import { RETENTION_MS, MemoryRetention, type RetentionIndex } from './retentionIndex'
import { fitGeneratedName } from '@abele/sync-sdk/protocol'

export const CONDITIONAL_RETENTION_MS = RETENTION_MS
export const CONDITIONAL_RETENTION_BYTES = 512 * 1024 * 1024
export const CONDITIONAL_MIN_AGE_MS = 24 * 60 * 60 * 1000
const RETAINED_RECORD_OVERHEAD = 16 * 1024

/** Structurally matches the next SDK's host port while the current SDK remains pinned. */
export interface FileVersion {
  size: number
  mtime: number
  sha: string
}
export interface ConditionalFileOperation {
  path: string
  expected: FileVersion | null
  effect:
    | { kind: 'remove' }
    | { kind: 'move'; to: string }
    | { kind: 'write'; bytes: Uint8Array; mtime: number; receipt?: string }
    | { kind: 'install'; stageId: string }
}
interface Intent {
  checked?: boolean
  incoming?: { size: number; sha: string }
  receipt?: boolean
  path: string
  expected: FileVersion | null
  destination: string
  data: string
  kind: ConditionalFileOperation['effect']['kind']
}
interface CheckedLease {
  (): void
  check?(): void
  wait?<T>(work: Promise<T>): Promise<T>
}
export interface ConditionalFileHost {
  withMutationCheck?(check: () => void): ConditionalFileHost
  checked?: {
    maxBytes: number
    wait(path: string): Promise<void>
    acquire(paths: string[]): Promise<CheckedLease>
    publicationCheck(path: string): () => boolean
  }
  retention?: RetentionIndex
  root: string
  active: Set<string>
  check(): void
  validate(path: string, recovery?: boolean): void
  stat(path: string): Promise<{ type: string; size: number; mtime: number; ctime?: number } | null>
  retirementStat?(
    path: string
  ): Promise<{ type: string; size: number; mtime: number; ctime?: number } | null>
  fingerprint(path: string, signal?: AbortSignal): Promise<FileVersion>
  create(path: string, bytes: Uint8Array, mtime: number): Promise<void>
  read(path: string): Promise<Uint8Array>
  mkdir(path: string): Promise<void>
  list(path: string): Promise<{ files: string[]; folders: string[] }>
  capture(from: string, to: string): Promise<void>
  install(from: string, to: string): Promise<void>
  restoreDirectory?(from: string, to: string): Promise<void>
  flush(path: string, parentsOnly?: boolean): Promise<void>
  sameObject?(a: string, b: string): Promise<boolean>
  stage(
    id: string
  ): Promise<{ path: string; target: string; sealed: { size: number; sha: string } }>
  changed(paths: string[], known?: 'file' | null): void
  remove(path: string): Promise<void>
  rmdir?(path: string): Promise<void>
}
const idOf = (id: string) => {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(id))
    throw new EngineError('protocol', 'invalid installation receipt')
  return id
}
const missing = (error: unknown) =>
  (error as { code?: string })?.code === 'ENOENT' ||
  /^ENOENT\b/.test((error as { message?: string })?.message ?? '')

const operationRevisions = new WeakMap<Set<string>, { value: number }>()
function revisionOf(active: Set<string>): { value: number } {
  let revision = operationRevisions.get(active)
  if (!revision) operationRevisions.set(active, (revision = { value: 0 }))
  return revision
}

/** Every continuation must revalidate its lease before starting another host effect. */
function leasedHost(
  host: ConditionalFileHost,
  current: () => CheckedLease | undefined,
  pending?: Map<Promise<unknown>, string>
): ConditionalFileHost {
  const checked = host.withMutationCheck?.(() => current()?.check?.()) ?? host
  return new Proxy(checked, {
    get(target, key) {
      const value = Reflect.get(target, key)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        const lease = current()
        lease?.check?.()
        const result = value.apply(target, args)
        if (result && typeof result.then === 'function') {
          if (lease && pending) {
            const work = Promise.resolve(result)
            pending.set(work, String(key))
            void work.then(
              () => pending.delete(work),
              () => pending.delete(work)
            )
          }
          return (lease?.wait ? lease.wait(Promise.resolve(result)) : result).then(
            (answer: unknown) => {
              lease?.check?.()
              return answer
            }
          )
        }
        lease?.check?.()
        return result
      }
    },
  })
}

/** Quarantine is retained evidence, never disposable staging or an equality receipt. */
export class ConditionalFiles {
  private readonly lateRepairs = new Set<Promise<void>>()
  private readonly fallback = new MemoryRetention()
  private migration?: { paths: string[]; at: number }
  private softWarning = false
  private get index(): RetentionIndex {
    return this.host.retention ?? this.fallback
  }
  constructor(
    private readonly host: ConditionalFileHost,
    private readonly retentionBytes = CONDITIONAL_RETENTION_BYTES
  ) {}
  assertSettled(previous?: number): number {
    const revision = revisionOf(this.host.active).value
    if (this.host.active.size || (previous !== undefined && previous !== revision))
      throw new EngineError('io', 'scan held while conditional file effects are in flight')
    return revision
  }
  private async record(path: string, value: unknown) {
    await this.host.create(path, new TextEncoder().encode(JSON.stringify(value)), 0)
    await this.host.flush(path)
  }
  private async retireVictim(folder: string, intent: Intent): Promise<void> {
    const h = this.host,
      id = idOf(folder.split('/').at(-1)),
      victim = folder + '/victim'
    const retained = h.root + '/trash/' + id,
      pointer = h.root + '/retained/' + id + '.json'
    if (!(await h.stat(victim))) {
      const info = await h.stat(retained + '/victim')
      if (info && !(await h.stat(retained + '/ready'))) {
        await h.flush(retained + '/victim')
        await this.flushFormerParent(folder)
        await this.index.put({
          id,
          at: Date.now(),
          size: info.size + RETAINED_RECORD_OVERHEAD,
          intent,
        })
        await this.record(retained + '/ready', true)
      }
      return
    }
    if (await h.stat(retained + '/victim'))
      throw new EngineError('io', 'retained victim destination is occupied')
    // Unresolved legacy captures keep their existing review semantics. Equality
    // authorizes retention as a settled base, never immediate unlinking.
    if (!intent.expected) return
    const info = await h.stat(victim)
    const have = info?.type === 'file' ? await h.fingerprint(victim) : null
    if (
      !info ||
      !have ||
      have.sha !== intent.expected.sha ||
      have.size !== intent.expected.size ||
      Math.round(info.mtime) !== intent.expected.mtime
    ) {
      await this.restore(victim, intent.path)
      return
    }
    await h.mkdir(retained)
    await h.mkdir(h.root + '/retained')
    let existing = false
    let retainedAt = Date.now()
    if (await h.stat(pointer)) {
      try {
        const value = JSON.parse(new TextDecoder().decode(await h.read(pointer)))
        retainedAt = value.at
        existing = true
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        // A partial pre-move record owns no captured bytes at its destination yet.
        if (await h.stat(retained + '/victim')) throw error
        await h.remove(pointer)
      }
    }
    if (!existing) {
      await this.record(pointer, { intent, at: retainedAt })
    }
    await this.index.put({ id, at: retainedAt, size: info.size + RETAINED_RECORD_OVERHEAD, intent })
    await h.capture(victim, retained + '/victim')
    await h.flush(retained + '/victim')
    await h.flush(victim, true)
    // A crash before capture acknowledgement must not backdate the minimum age.
    await this.index.put({ id, at: Date.now(), size: info.size + RETAINED_RECORD_OVERHEAD, intent })
    await this.record(retained + '/ready', true)
    const summary = await this.index.summary()
    if (summary.bytes > this.retentionBytes && !this.softWarning) {
      this.softWarning = true
      console.debug(
        '[abele-sync] retained files exceed soft target; minimum age protects them',
        summary.bytes,
        this.retentionBytes
      )
    }
  }

  /** One victim (or eight legacy metadata records) per idle tick. Never called by startup. */
  async maintenanceStep(assertIdle: () => void = () => {}, signal?: AbortSignal): Promise<void> {
    assertIdle()
    const h = new Proxy(this.host, {
        get(target, key) {
          const value =
            key === 'stat' && target.retirementStat
              ? target.retirementStat.bind(target)
              : Reflect.get(target, key)
          if (typeof value !== 'function') return value
          return (...args: unknown[]) => {
            assertIdle()
            const result = value.apply(target, args)
            if (result && typeof result.then === 'function')
              return result.then((value: unknown) => {
                assertIdle()
                return value
              })
            assertIdle()
            return result
          }
        },
      }),
      summary = await this.index.summary()
    const maintenance = new ConditionalFiles(h, this.retentionBytes)
    h.check()
    if (!summary.migrated) {
      if (!this.migration) {
        const root = h.root + '/retained'
        this.migration = { paths: (await h.stat(root)) ? (await h.list(root)).files : [], at: 0 }
      }
      for (let n = 0; n < 8 && this.migration.at < this.migration.paths.length; n++) {
        const pointer = this.migration.paths[this.migration.at],
          id = idOf(
            pointer
              .split('/')
              .at(-1)
              .replace(/\.json$/, '')
          )
        const value = JSON.parse(new TextDecoder().decode(await h.read(pointer)))
        if (!value.intent || !Number.isFinite(value.at))
          throw new EngineError('io', 'invalid retained victim record')
        const info =
          (await h.stat(h.root + '/trash/' + id + '/victim')) ??
          (await h.stat(h.root + '/trash/' + id + '/dying')) ??
          (await h.stat(h.root + '/objects/' + id + '/victim'))
        if (!(await this.index.find(id)))
          await this.index.put({
            id,
            // Legacy pointers precede capture and adapter ctime may be creation time.
            // Without a durable capture acknowledgement, start a fresh retention age.
            at: Math.max(Date.now(), value.at, info?.ctime ?? value.at),
            size: (info?.size ?? 0) + RETAINED_RECORD_OVERHEAD,
            intent: value.intent,
          })
        this.migration.at++
      }
      if (this.migration.at === this.migration.paths.length) {
        await this.index.migrated()
        this.migration = undefined
      }
      return
    }
    const now = Date.now(),
      over = summary.bytes > this.retentionBytes
    if (!over && (summary.earliestExpiry === null || summary.earliestExpiry > now)) return
    const item = await this.index.oldest()
    if (!item || h.active.has(h.root + '/' + item.id)) return
    const key = h.root + '/' + item.id
    h.active.add(key)
    try {
      if (now - item.at < CONDITIONAL_MIN_AGE_MS) {
        console.debug(
          '[abele-sync] retained files exceed soft target; minimum age protects them',
          summary.bytes,
          this.retentionBytes
        )
        return
      }
      const intent = item.intent as Intent,
        folder = h.root + '/trash/' + idOf(item.id)
      const victim = folder + '/victim',
        dying = folder + '/dying'
      h.validate(intent.path, true)
      if (!(await h.stat(folder + '/ready')) && !(await h.stat(dying))) {
        const source = h.root + '/objects/' + item.id + '/victim'
        if (!(await h.stat(victim)) && (await h.stat(source))) {
          await h.mkdir(folder)
          await h.capture(source, victim)
        }
        const info = await h.stat(victim)
        if (info) {
          await h.flush(victim)
          await h.flush(source, true)
          await this.index.put({ ...item, at: Date.now() })
          await maintenance.record(folder + '/ready', true)
          return
        }
      }
      if (!(await h.stat(victim)) && !(await h.stat(dying))) {
        const source = h.root + '/objects/' + item.id + '/victim'
        if (await h.stat(source)) {
          await h.mkdir(folder)
          if (await h.stat(folder + '/ready')) {
            await h.remove(folder + '/ready')
            await h.flush(folder + '/ready', true)
          }
          await h.capture(source, victim)
          await h.flush(victim)
          await this.index.put({ ...item, at: Date.now() })
          await maintenance.record(folder + '/ready', true)
          return
        }
      }
      if (await h.stat(victim)) {
        if (await h.stat(dying))
          throw new EngineError('io', 'retirement contains two retained occupants')
        await h.capture(victim, dying)
        await h.flush(dying)
        await h.flush(victim, true)
      }
      const info = await h.stat(dying)
      if (info) {
        let have: FileVersion | null = null
        try {
          if (info.type === 'file') have = await h.fingerprint(dying, signal)
        } catch (error) {
          if (!(error instanceof EngineError && error.code === 'conflict' && !error.cause))
            throw error
        }
        const last = await h.stat(dying),
          expected = intent.expected
        const changed =
          !have ||
          !expected ||
          !last ||
          !Number.isFinite(info.ctime) ||
          !Number.isFinite(last.ctime) ||
          last.type !== 'file' ||
          have.sha !== expected.sha ||
          have.size !== expected.size ||
          Math.round(info.mtime) !== expected.mtime ||
          last.size !== info.size ||
          last.mtime !== info.mtime ||
          last.ctime !== info.ctime
        if (changed) {
          const name = intent.path.slice(intent.path.lastIndexOf('/') + 1),
            dot = name.lastIndexOf('.')
          const target = fitGeneratedName(
            intent.path.slice(0, intent.path.lastIndexOf('/') + 1).normalize('NFC'),
            dot > 0 ? name.slice(0, dot) : name,
            dot > 0 ? name.slice(dot) : '',
            ' (Recovered copy ' + item.id + ')'
          )
          await maintenance.restore(dying, target, true)
        }
        // A descriptor may still write after this last check and before unlink. That residual
        // native window (normally microseconds) is accepted only after at least 24 hours;
        // the soft byte target never shortens that minimum age. Rename precedes fresh proof.
        h.check()
        if (!changed || (await h.stat(dying))) await h.remove(dying)
        await h.flush(dying, true)
      }
      await maintenance.clearPlans(folder)
      for (const name of ['restored', 'ready'])
        if (await h.stat(folder + '/' + name)) await h.remove(folder + '/' + name)
      if (h.rmdir && (await h.stat(folder))) await h.rmdir(folder)
      await h.flush(folder, true)
      const pointer = h.root + '/retained/' + item.id + '.json'
      if (await h.stat(pointer)) await h.remove(pointer)
      await h.flush(pointer, true)
      await this.index.drop(item.id)
    } finally {
      h.active.delete(key)
    }
  }
  async maintenanceDelay(): Promise<number | null> {
    const summary = await this.index.summary()
    if (!summary.migrated) return 0
    if (summary.bytes > this.retentionBytes) {
      const first = await this.index.oldest()
      return first ? Math.max(0, first.at + CONDITIONAL_MIN_AGE_MS - Date.now()) : null
    }
    return summary.earliestExpiry === null ? null : Math.max(0, summary.earliestExpiry - Date.now())
  }
  private async clearPlans(folder: string): Promise<void> {
    const h = this.host,
      plans = folder + '/restore-plans'
    if (!(await h.stat(plans))) return
    const listed = await h.list(plans)
    if (listed.folders.length) throw new EngineError('io', 'unexpected recovery plan directory')
    for (const path of listed.files) {
      idOf(path.slice(plans.length + 1).replace(/\.json$/, ''))
      await h.remove(path)
    }
    if (h.rmdir) await h.rmdir(plans)
  }
  private async flushFormerParent(folder: string): Promise<void> {
    while (!(await this.host.stat(folder))) {
      if (folder === this.host.root) throw new EngineError('io', 'conditional root is missing')
      folder = folder.slice(0, folder.lastIndexOf('/'))
    }
    await this.host.flush(folder)
  }
  private async install(
    from: string,
    to: string,
    published?: (value: boolean) => void
  ): Promise<boolean> {
    published?.(true) // Treat a lost acknowledgement as possibly published until disproved.
    try {
      await this.host.install(from, to)
    } catch (error) {
      if (
        this.host.checked &&
        (error as { code?: string })?.code !== 'EEXIST' &&
        !/^(EEXIST\b|File already exists|Destination file already exists)/.test(
          (error as Error)?.message ?? ''
        )
      )
        throw error
      if ((await this.host.stat(to)) === null) {
        published?.(false)
        throw error
      }
      if (!(await this.host.sameObject?.(from, to))) {
        published?.(false)
        return false
      }
    }
    await this.host.flush(to)
    return true
  }
  private async restore(from: string, to: string, retained = false, evidenceFolder?: string) {
    const folder = evidenceFolder ?? from.slice(0, from.lastIndexOf('/'))
    const restored =
      folder +
      (from === folder + '/victim'
        ? '/restored'
        : evidenceFolder || from === folder + '/data'
          ? '/data-restored'
          : '/restored')
    if (await this.host.stat(restored)) return
    const id = folder.split('/').at(-1)
    // The existing durable review pointer is also restoration's settlement record.
    // Keep reading the old marker for records written by earlier hosts.
    if (!retained && (await this.host.stat(this.host.root + '/review/' + id + '.json'))) return
    const info = await this.host.stat(from)
    if (!info) return
    const allocation = folder + '/allocation'
    if ((await this.host.stat(allocation)) && (await this.host.sameObject?.(from, allocation))) {
      await this.host.remove(from)
      await this.host.flush(from, true)
      return
    }
    this.host.check()
    const plans = folder + '/restore-plans'
    const finish = async (destination: string, durable = false) => {
      if (!durable) await this.host.flush(destination)
      if (retained) await this.record(restored, true)
      else await this.archive(folder, id, false)
      this.host.changed([destination])
    }
    // A durable plan also finds a randomly named publication after restart.
    const findPublished = async (): Promise<string | null> => {
      if (info.type === 'file' && this.host.sameObject && (await this.host.stat(plans))) {
        for (const plan of (await this.host.list(plans)).files) {
          const bytes = await this.host.read(plan)
          let destination: string
          try {
            const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
            if (
              !value ||
              typeof value !== 'object' ||
              !('destination' in value) ||
              typeof value.destination !== 'string'
            )
              throw new Error('invalid restore plan')
            destination = value.destination
          } catch (error) {
            this.host.check()
            // Publication is never attempted until record() has populated and flushed
            // the plan. A partial/invalid plan cannot authorize an installation.
            console.debug('[abele-sync] ignoring incomplete restore plan', plan, error)
            continue
          }
          // Runtime validation (including reservations) is not malformed metadata.
          // Uncertainty about an earlier publication must keep this record pending.
          this.host.validate(destination, true)
          if (
            (await this.host.stat(destination)) &&
            (await this.host.sameObject(from, destination))
          ) {
            return destination
          }
        }
      }
      return null
    }
    const previous = await findPublished()
    if (previous !== null) {
      await finish(previous)
      return
    }
    let rootFallback = false
    const parents = to.split('/').slice(0, -1)
    try {
      for (let end = 1; end <= parents.length; end++) {
        const parent = await this.host.stat(parents.slice(0, end).join('/'))
        if (parent === null) break
        if (parent.type !== 'folder') {
          rootFallback = true
          break
        }
      }
    } catch (error) {
      this.host.check()
      console.debug('[abele-sync] sibling inspection failed; restoring at vault root', error)
      rootFallback = true
    }
    let rootAttempts = 0
    for (let attempt = 0; attempt < 16; attempt++) {
      if (attempt >= 8) rootFallback = true
      this.host.check()
      let published = false
      try {
        const file = to.slice(to.lastIndexOf('/') + 1),
          dot = file.lastIndexOf('.')
        const stem = dot > 0 ? file.slice(0, dot) : file,
          ext = dot > 0 ? file.slice(dot) : ''
        const suffix =
          ' (Conflicted copy restored ' +
          ((rootFallback ? rootAttempts++ === 0 : attempt === 1) ? id : crypto.randomUUID()) +
          ')'
        // Fit the protocol's NFC spelling, then keep the actual disk parent's spelling.
        // Normalising a physical parent can select a different directory on some hosts.
        const physicalParent = to.slice(0, to.lastIndexOf('/') + 1)
        const fitted =
          attempt === 0 && !rootFallback
            ? to
            : fitGeneratedName(
                rootFallback ? '' : physicalParent.normalize('NFC'),
                stem.normalize('NFC'),
                ext.normalize('NFC'),
                suffix
              )
        let destination =
          fitted.includes('/') && !(attempt === 0 && !rootFallback)
            ? physicalParent + fitted.slice(fitted.lastIndexOf('/') + 1)
            : fitted
        this.host.validate(
          destination,
          rootFallback || (!destination.includes('/') && to.includes('/'))
        )
        const parent = destination.slice(0, Math.max(0, destination.lastIndexOf('/')))
        if (parent) await this.host.mkdir(parent)
        if ((await this.host.stat(destination)) !== null) {
          if (info.type === 'file' && (await this.host.sameObject?.(from, destination))) {
            published = true
            await finish(destination)
            return
          }
          continue
        }
        if (info.type === 'file') {
          await this.host.mkdir(plans)
          await this.record(plans + '/' + crypto.randomUUID() + '.json', { destination })
          // Re-read all operation destinations after the awaited preparations.
          // A failed probe must not be turned into another fallback publication.
          published = true
          const existing = await findPublished()
          if (existing !== null) {
            await finish(existing)
            return
          }
          published = false
          if (
            !(await this.install(from, destination, (value) => {
              published = value
            }))
          )
            continue
        } else {
          if (!this.host.restoreDirectory)
            throw new EngineError('io', 'directory restoration unavailable')
          try {
            await this.host.restoreDirectory(from, destination)
            published = true
          } catch (error) {
            if ((await this.host.stat(destination)) !== null) continue
            throw error
          }
          await this.host.flush(destination, true)
          await this.host.flush(from, true)
        }
        await finish(destination, true)
        return
      } catch (error) {
        this.host.check()
        if (published || rootFallback) throw error
        console.debug('[abele-sync] sibling restoration failed; restoring at vault root', error)
        rootFallback = true
      }
    }
    throw new EngineError('io', 'visible recovery destinations are occupied')
  }
  private async archive(_folder: string, id: string, successful: boolean) {
    let source = this.host.root + '/active/' + id + '.json'
    if (!(await this.host.stat(source))) {
      if (successful) return
      source = this.host.root + '/completed/' + id + '.json'
      if (!(await this.host.stat(source))) return
    }
    const parent = this.host.root + (successful ? '/completed' : '/review')
    await this.host.mkdir(parent)
    await this.host.capture(source, parent + '/' + id + '.json')
    await this.host.flush(parent + '/' + id + '.json')
    await this.host.flush(source, true)
  }
  private async repairIntent(folder: string, id: string) {
    const h = this.host
    const intent = JSON.parse(
      new TextDecoder().decode(await h.read(folder + '/intent.json'))
    ) as Intent
    h.validate(intent.path)
    h.check()
    let restoreIncoming = intent.checked && intent.data !== folder + '/victim'
    if (restoreIncoming && intent.incoming && (await h.stat(intent.data))) {
      const have = await h.fingerprint(intent.data)
      if (have.size !== intent.incoming.size || have.sha !== intent.incoming.sha) {
        // A failed payload write is retained evidence, never a public recovered file.
        restoreIncoming = false
        console.debug('[abele-sync] incomplete incoming bytes retained privately', intent.path)
      }
    }
    // Both restorations share one recovery intent. Settle the victim independently
    // without archiving that intent before the incoming copy has a public home.
    await this.restore(folder + '/victim', intent.path, restoreIncoming)
    if (restoreIncoming) await this.restore(intent.data, intent.path, true, folder)
    await this.archive(folder, id, false)
    h.changed([intent.path])
  }
  private repairAfterSettlement(
    folder: string,
    id: string,
    pending: Map<Promise<unknown>, string>
  ) {
    const h = this.host,
      key = h.root + '/' + id
    const calls = [...pending]
    const repair = (async () => {
      await Promise.allSettled(calls.map(([work]) => work))
      h.check()
      const intent = JSON.parse(
        new TextDecoder().decode(await h.read(folder + '/intent.json'))
      ) as Intent
      const victim = folder + '/victim'
      let captured: FileVersion | null = null
      try {
        if ((await h.stat(victim))?.type === 'file') captured = await h.fingerprint(victim)
      } catch (error) {
        // A diagnostic hash is not authority to strand captured user bytes. Restore
        // them conservatively even when bounded verification is unavailable.
        console.debug(
          '[abele-sync] late capture cannot be fingerprinted; restoring retained bytes',
          error
        )
      }
      // The active intent predates the effect. This additional record describes its
      // late settlement; a crash before it is written still recovers from the intent.
      if (!(await h.stat(folder + '/late-effect.json')))
        await this.record(folder + '/late-effect.json', {
          methods: [...new Set(calls.map(([, method]) => method))],
          captured,
          matchesExpected:
            captured !== null &&
            captured.sha === intent.expected?.sha &&
            captured.size === intent.expected?.size,
        })
      console.debug(
        '[abele-sync] conditional refusal: repairing late effect',
        intent.path,
        calls.map(([, method]) => method)
      )
      await this.repairIntent(folder, id)
    })()
      .catch((error: unknown) => {
        console.debug('[abele-sync] late effect repair remains pending', id, error)
      })
      .finally(() => {
        h.active.delete(key)
        this.lateRepairs.delete(repair)
      })
    this.lateRepairs.add(repair)
  }
  /** Host recovery may preserve any current bytes, but never overwrite or discard them. */
  async retainUncertain(path: string, to: string): Promise<boolean> {
    const info = await this.host.stat(path)
    if (!info || info.type !== 'file') return false
    return this.apply(
      {
        path,
        expected: { size: info.size, mtime: Math.round(info.mtime), sha: '' },
        effect: { kind: 'move', to },
      },
      true
    )
  }
  async apply(op: ConditionalFileOperation, retainUnknown = false): Promise<boolean> {
    const revision = revisionOf(this.host.active)
    revision.value++
    try {
      return await this.applyOwned(op, retainUnknown)
    } finally {
      revision.value++
    }
  }
  private async applyOwned(op: ConditionalFileOperation, retainUnknown: boolean): Promise<boolean> {
    const h = this.host
    h.check()
    h.validate(op.path)
    if (op.effect.kind === 'move') h.validate(op.effect.to)
    if (retainUnknown && op.effect.kind !== 'move')
      throw new EngineError('protocol', 'Retention requires an exclusive move')
    if (!h.sameObject && h.checked) return this.applyChecked(op, retainUnknown)
    // Object identity distinguishes allocation sentinels from captured empty files.
    if (op.expected !== null && !h.sameObject)
      throw new EngineError('io', 'conditional capture requires durable object identity')
    const id = idOf(
      (op.effect.kind === 'write' ? op.effect.receipt : undefined) ?? crypto.randomUUID()
    )
    const folder = h.root + '/objects/' + id,
      victim = folder + '/victim'
    const activeKey = h.root + '/' + id
    if (h.active.has(activeKey)) return false
    h.active.add(activeKey)
    let captured = false,
      recorded = false
    const restore = async () => {
      await this.restore(victim, op.path)
    }
    try {
      if ((await h.stat(folder)) !== null) return false
      let source = victim
      if (op.effect.kind === 'install') {
        const stage = await h.stage(op.effect.stageId)
        if (stage.target !== op.path) throw new EngineError('conflict', 'stage target changed')
        const have = await h.fingerprint(stage.path)
        if (have.size !== stage.sealed.size || have.sha !== stage.sealed.sha)
          throw new EngineError('conflict', 'sealed stage changed')
        source = stage.path
      }
      const intent: Intent = {
        receipt: op.effect.kind === 'write' && op.effect.receipt !== undefined,
        path: op.path,
        expected: op.expected,
        destination: op.effect.kind === 'move' ? op.effect.to : op.path,
        data: op.effect.kind === 'write' ? folder + '/data' : source,
        kind: op.effect.kind,
      }
      await h.mkdir(folder)
      if (op.expected !== null) {
        await h.create(folder + '/allocation', new Uint8Array(), 0)
        await h.flush(folder + '/allocation')
      }
      await this.record(folder + '/intent.json', intent)
      await h.mkdir(h.root + '/active')
      await this.record(h.root + '/active/' + id + '.json', intent)
      recorded = true
      h.check()
      if (op.expected !== null) {
        // Never move a directory tree out of the user's namespace as a file victim.
        const before = await h.stat(op.path)
        if (before !== null && before.type !== 'file') {
          await this.archive(folder, id, false)
          return false
        }
        try {
          // The filesystem refuses a directory substituted at the capture boundary.
          if (!(await this.install(folder + '/allocation', victim)))
            throw new EngineError('io', 'capture sentinel is occupied')
          await h.capture(op.path, victim)
          captured = true
        } catch (error) {
          const standing = await h.stat(op.path)
          if (!missing(error) && standing?.type !== 'folder') throw error
          await restore()
          const removed = op.effect.kind === 'remove' && (await h.stat(op.path)) === null
          if (removed) await this.record(folder + '/complete', true)
          await this.archive(folder, id, removed)
          if (removed) await this.discardOwned(id, intent)
          return removed
        }
        await h.flush(victim)
        await h.flush(op.path, true)
        const info = await h.stat(victim)
        const have = !retainUnknown && info?.type === 'file' ? await h.fingerprint(victim) : null
        if (
          !retainUnknown &&
          (!have ||
            have.size !== op.expected.size ||
            Math.max(0, Math.round(info.mtime)) !== op.expected.mtime ||
            have.sha !== op.expected.sha)
        ) {
          await restore()
          await this.archive(folder, id, false)
          return false
        }
      } else if ((await h.stat(op.path)) !== null) {
        await this.archive(folder, id, false)
        return false
      }
      h.check()
      if (op.effect.kind !== 'remove') {
        if (op.effect.kind === 'move' && !captured) {
          await this.archive(folder, id, false)
          return false
        }
        if (op.effect.kind === 'write') {
          source = folder + '/data'
          await h.create(source, op.effect.bytes, op.effect.mtime)
          await h.flush(source)
        }
        const parent = intent.destination.slice(0, Math.max(0, intent.destination.lastIndexOf('/')))
        if (parent) await h.mkdir(parent)
        h.check()
        if (!(await this.install(source, intent.destination))) {
          await restore()
          await this.archive(folder, id, false)
          return false
        }
      }
      if (
        retainUnknown &&
        op.effect.kind === 'move' &&
        (await h.sameObject?.(victim, op.effect.to))
      )
        await h.remove(victim) // Only an alias; the acknowledged retained destination owns the inode.
      // New bytes have a public home even if later journal settlement fails.
      if (op.effect.kind === 'write' || op.effect.kind === 'install') h.changed([op.path], 'file')
      // A completed marker is durable before the operation leaves the recovery queue.
      await this.record(folder + '/complete', true)
      await this.retireVictim(folder, intent)
      await this.archive(folder, id, true)
      if (!intent.receipt) await this.discardOwned(id, intent)
      if (op.effect.kind === 'move') {
        h.changed([op.path], null)
        h.changed([op.effect.to], 'file')
      } else if (op.effect.kind === 'remove') h.changed([op.path], null)
      return true
    } catch (error) {
      // Capture itself may have reached disk before its acknowledgement was lost.
      // Publication is already durable. Leave retirement in the active queue
      // instead of archiving it through victim restoration after a later failure.
      if (recorded && !(await h.stat(folder + '/complete'))) await restore()
      throw error
    } finally {
      h.active.delete(activeKey)
    }
  }
  /** Content decision plus a pending-save/stat fence; no object-identity claim. */
  private async applyChecked(
    op: ConditionalFileOperation,
    retainUnknown = false
  ): Promise<boolean> {
    const pending = new Map<Promise<unknown>, string>()
    const h = leasedHost(this.host, () => release, pending),
      checked = h.checked
    const operation = new ConditionalFiles(h)
    const observe = async (path: string): Promise<FileVersion | null> => {
      try {
        return await h.fingerprint(path)
      } catch (error) {
        if (error instanceof EngineError && error.code === 'conflict' && !error.cause) return null
        throw error
      }
    }
    const id = idOf(
      (op.effect.kind === 'write' ? op.effect.receipt : undefined) ?? crypto.randomUUID()
    )
    const folder = h.root + '/objects/' + id,
      victim = folder + '/victim',
      key = h.root + '/' + id
    if (h.active.has(key)) return false
    h.active.add(key)
    let recorded = false,
      repairing = false
    let release: CheckedLease | undefined
    try {
      if (await h.stat(folder)) return false
      let payload: Uint8Array | undefined
      let stagePath: string | undefined
      let mtime = 0
      if (op.effect.kind === 'write') {
        payload = op.effect.bytes
        mtime = op.effect.mtime
      } else if (op.effect.kind === 'install') {
        const stage = await h.stage(op.effect.stageId)
        if (stage.target !== op.path) throw new EngineError('conflict', 'stage target changed')
        if (stage.sealed.size > checked.maxBytes) return false
        const have = await h.fingerprint(stage.path)
        if (have.size !== stage.sealed.size || have.sha !== stage.sealed.sha)
          throw new EngineError('conflict', 'sealed stage changed')
        stagePath = stage.path
        mtime = (await h.stat(stage.path))?.mtime ?? 0
      }
      if (payload && payload.length > checked.maxBytes) return false
      const publicationAllowed = checked.publicationCheck(op.path)
      const destination = op.effect.kind === 'move' ? op.effect.to : op.path
      const parent = destination.slice(0, Math.max(0, destination.lastIndexOf('/')))
      if (parent) await h.mkdir(parent)
      const first = await h.stat(op.path)
      if (first && (first.type !== 'file' || (!retainUnknown && first.size > checked.maxBytes)))
        return false
      if (op.expected && first === null && op.effect.kind === 'remove') {
        await checked.wait(op.path)
        return (await h.stat(op.path)) === null
      }
      if (op.expected === null ? first !== null : first === null) return false
      if (op.expected && !retainUnknown) {
        const have = await observe(op.path)
        if (!have || have.sha !== op.expected.sha || have.size !== op.expected.size) return false
      }
      const intent: Intent = {
        checked: true,
        ...(payload ? { incoming: { size: payload.length, sha: await sha256(payload) } } : {}),
        receipt: op.effect.kind === 'write' && op.effect.receipt !== undefined,
        path: op.path,
        expected: op.expected && { ...op.expected, mtime: Math.max(0, Math.round(first.mtime)) },
        destination,
        data: stagePath ?? (payload ? folder + '/data' : victim),
        kind: op.effect.kind,
      }
      await h.mkdir(folder)
      await operation.record(folder + '/intent.json', intent)
      await h.mkdir(h.root + '/active')
      await operation.record(h.root + '/active/' + id + '.json', intent)
      recorded = true
      if (payload) {
        await h.create(intent.data, payload, mtime)
        await h.flush(intent.data)
      }
      await checked.wait(op.path)
      if (destination !== op.path) await checked.wait(destination)
      release = await checked.acquire([op.path, destination])
      const last = await h.stat(op.path)
      if (
        first === null
          ? last !== null
          : !last || last.type !== 'file' || last.size !== first.size || last.mtime !== first.mtime
      ) {
        console.debug('[abele-sync] conditional file changed locally; retry later', op.path)
        // No public mutation was attempted; this intent owns no retained user bytes.
        await operation.record(folder + '/complete', true)
        await operation.archive(folder, id, true)
        await operation.discardOwned(id, intent)
        return false
      }
      h.check()
      if (op.expected) {
        await h.capture(op.path, victim)
        // The pre-gate hash is only a decision hint. Authenticate the captured bytes
        // before publication or retirement, including same-size, same-time edits.
        const info = await h.stat(victim)
        const captured = !retainUnknown && info?.type === 'file' ? await observe(victim) : null
        if (
          !retainUnknown &&
          (!info ||
            info.type !== 'file' ||
            info.size !== op.expected.size ||
            info.mtime !== first.mtime ||
            !captured ||
            captured.sha !== op.expected.sha ||
            captured.size !== op.expected.size)
        ) {
          await operation.restore(victim, op.path)
          await operation.archive(folder, id, false)
          return false
        }
      }
      if (payload || stagePath) {
        if (
          !publicationAllowed() ||
          (await h.stat(op.path)) ||
          !(await operation.install(intent.data, op.path))
        ) {
          await operation.repairIntent(folder, id)
          // Both versions now have acknowledged public destinations. Receipt retirement
          // may remove only this operation's metadata, never either recovered copy.
          await operation.record(folder + '/complete', true)
          await operation.archive(folder, id, false)
          if (!intent.receipt) await operation.discardOwned(id, intent)
          console.debug('[abele-sync] publication occupied; incoming bytes recovered', op.path)
          return false
        }
      } else if (op.effect.kind === 'move' && !(await operation.install(victim, destination))) {
        await operation.restore(victim, op.path)
        await operation.archive(folder, id, false)
        return false
      }
      release?.()
      release = undefined
      if (op.effect.kind === 'write' || op.effect.kind === 'install') h.changed([op.path], 'file')
      await operation.record(folder + '/complete', true)
      await operation.retireVictim(folder, intent)
      await operation.archive(folder, id, true)
      if (!intent.receipt) await operation.discardOwned(id, intent)
      if (op.effect.kind === 'move') {
        h.changed([op.path], null)
        h.changed([destination], 'file')
      } else if (op.effect.kind === 'remove') h.changed([op.path], null)
      return true
    } catch (cause) {
      let error = cause
      try {
        release?.check?.()
      } catch (expired) {
        error = expired
      }
      if (error instanceof EngineError && Reflect.get(error, 'leaseExpired') === true) {
        // A foreign wrapper can still submit the captured callable. Keep ownership
        // until it settles so concurrent recovery cannot archive an empty victim.
        if (recorded) {
          repairing = true
          this.repairAfterSettlement(folder, id, pending)
        }
        console.debug('[abele-sync] checked operation refused after lease expiry', op.path)
        return false
      }
      try {
        if (recorded && (await h.stat(folder + '/complete'))) throw error
        // Error recovery owns both the captured victim and incoming data. Never
        // archive the shared intent after restoring only the victim.
        if (recorded) await operation.repairIntent(folder, id)
        if (
          (error as { code?: string })?.code === 'EEXIST' ||
          /^(EEXIST\b|File already exists|Destination file already exists)/.test(
            (error as Error)?.message ?? ''
          )
        ) {
          if (recorded) await operation.archive(folder, id, false)
          return false
        }
      } catch (cleanupError) {
        if (
          cleanupError instanceof EngineError &&
          Reflect.get(cleanupError, 'leaseExpired') === true
        )
          return false
        throw cleanupError
      }
      throw error
    } finally {
      release?.()
      if (!repairing) h.active.delete(key)
    }
  }
  /** Turn refused first publication into journalled visible conflict evidence. */
  async recoverIncoming(from: string, path: string, lease?: CheckedLease): Promise<void> {
    const pending = new Map<Promise<unknown>, string>()
    const h = leasedHost(this.host, () => lease, pending),
      operation = new ConditionalFiles(h),
      id = crypto.randomUUID(),
      folder = h.root + '/objects/' + id
    const intent: Intent = {
      checked: true,
      path,
      expected: null,
      destination: path,
      data: folder + '/data',
      kind: 'write',
    }
    h.validate(path)
    const key = h.root + '/' + id
    h.active.add(key)
    let recorded = false,
      repairing = false
    try {
      await h.mkdir(folder)
      await operation.record(folder + '/intent.json', intent)
      await h.mkdir(h.root + '/active')
      await operation.record(h.root + '/active/' + id + '.json', intent)
      recorded = true
      await h.capture(from, intent.data)
      await operation.restore(intent.data, path, true)
      await operation.record(folder + '/complete', true)
      await operation.archive(folder, id, false)
      await operation.discardOwned(id, intent)
      console.debug('[abele-sync] publication occupied; incoming bytes recovered', path)
    } catch (error) {
      if (recorded && Reflect.get(Object(error), 'leaseExpired') === true) {
        repairing = true
        this.repairAfterSettlement(folder, id, pending)
      }
      throw error
    } finally {
      if (!repairing) h.active.delete(key)
    }
  }
  async recover(): Promise<void> {
    const revision = revisionOf(this.host.active)
    const h = this.host
    let failed: unknown
    const retiring = h.root + '/retiring'
    if (await h.stat(retiring)) {
      for (const marker of (await h.list(retiring)).files) {
        try {
          await this.discard(idOf(marker.slice(retiring.length + 1).replace(/\.json$/, '')))
        } catch (error) {
          failed ??= error
        }
      }
    }
    try {
      await this.index.summary()
    } catch (error) {
      failed ??= error
    }
    for (const root of [h.root + '/active', h.root + '/completed']) {
      if ((await h.stat(root)) === null) continue
      for (const pointer of (await h.list(root)).files) {
        const candidate = pointer.slice(root.length + 1).replace(/\.json$/, '')
        const activeKey = h.root + '/' + candidate
        if (h.active.has(activeKey)) continue
        h.active.add(activeKey)
        revision.value++
        try {
          const id = idOf(candidate)
          const folder = h.root + '/objects/' + id
          if ((await h.stat(pointer)) === null) continue
          if ((await h.stat(folder + '/complete')) !== null) {
            const intent = JSON.parse(
              new TextDecoder().decode(await h.read(folder + '/intent.json'))
            ) as Intent
            await h.flush(intent.destination ?? intent.path, true)
            await this.retireVictim(folder, intent)
            await this.archive(folder, id, true)
            if (!intent.receipt) await this.discardOwned(id, intent)
            continue
          }
          if ((await h.stat(folder + '/intent.json')) === null) {
            // No capture was authorized before this file existed.
            await this.archive(folder, id, false)
            continue
          }
          await this.repairIntent(folder, id)
        } catch (error) {
          // Keep this pointer outstanding, but do not strand independent victims.
          failed ??= error
          console.debug('[abele-sync] conditional recovery remains pending', pointer, error)
        } finally {
          h.active.delete(activeKey)
          revision.value++
        }
      }
    }
    if (failed) throw new EngineError('io', 'conditional recovery remains pending', failed)
  }
  async installed(receipt: string, path: string, sha: string): Promise<boolean> {
    const h = this.host
    h.validate(path)
    if (!h.sameObject) return false // Equality cannot certify mobile publication after a restart.
    const folder = h.root + '/objects/' + idOf(receipt)
    if ((await h.stat(folder + '/intent.json')) === null) return false
    const intent = JSON.parse(
      new TextDecoder().decode(await h.read(folder + '/intent.json'))
    ) as Intent
    if (intent.destination !== path || !['write', 'install'].includes(intent.kind)) return false
    try {
      const installed =
        (await h.sameObject(intent.data, path)) &&
        (await h.fingerprint(path)).sha === sha &&
        (await h.sameObject(intent.data, path))
      if (installed) await h.flush(path)
      return installed
    } catch (error) {
      if (!missing(error)) throw error
    }
    return false
  }
  async discard(receipt: string): Promise<void> {
    const key = this.host.root + '/' + idOf(receipt)
    if (this.host.active.has(key))
      throw new EngineError('conflict', 'conditional entry is active; retry cleanup later')
    this.host.active.add(key)
    try {
      await this.discardOwned(receipt)
    } finally {
      this.host.active.delete(key)
    }
  }
  private async discardOwned(receipt: string, settledIntent?: Intent): Promise<void> {
    const h = this.host,
      id = idOf(receipt),
      folder = h.root + '/objects/' + id
    const marker = h.root + '/retiring/' + id + '.json'
    let state: { intent?: Intent } | undefined
    if (await h.stat(marker)) {
      try {
        state = JSON.parse(new TextDecoder().decode(await h.read(marker)))
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
      }
    }
    if (!state) {
      let intent: Intent | undefined
      if (settledIntent) {
        // The caller has just durably completed this active operation. Restart
        // cleanup still reads its journal; same-process cleanup need not read it back.
        intent = settledIntent
      } else if (await h.stat(folder + '/intent.json')) {
        intent = JSON.parse(new TextDecoder().decode(await h.read(folder + '/intent.json')))
        if (!(await h.stat(folder + '/complete')))
          throw new EngineError('io', 'installation has not settled')
      } else if (await h.stat(h.root + '/completed/' + id + '.json')) {
        intent = JSON.parse(
          new TextDecoder().decode(await h.read(h.root + '/completed/' + id + '.json'))
        )
      } else if (await h.stat(folder + '/victim')) {
        throw new EngineError('io', 'unsettled victim has no retirement intent')
      } else if (
        !(await h.stat(marker)) &&
        !(await h.stat(folder)) &&
        !(await h.stat(h.root + '/review/' + id + '.json'))
      )
        return
      state = { intent }
      if (await h.stat(marker)) await h.remove(marker)
      await h.mkdir(h.root + '/retiring')
      await this.record(marker, state)
    }
    if (state.intent) {
      await h.flush(state.intent.destination ?? state.intent.path, true)
      await this.retireVictim(folder, state.intent)
    }
    if (await h.stat(folder + '/victim')) {
      // This is an unresolved review, not interrupted metadata deletion. Keep its
      // intact intent and victim rather than retrying destructive cleanup on startup.
      if (await h.stat(marker)) await h.remove(marker)
      await h.flush(marker, true)
      return
    }
    for (const path of [
      folder + '/data',
      folder + '/allocation',
      folder + '/complete',
      folder + '/late-effect.json',
      folder + '/restored',
      folder + '/intent.json',
      h.root + '/completed/' + id + '.json',
      h.root + '/active/' + id + '.json',
      h.root + '/review/' + id + '.json',
    ]) {
      if (await h.stat(path)) await h.remove(path)
    }
    if (state.intent?.checked && (await h.stat(folder + '/data-restored')))
      await h.remove(folder + '/data-restored')
    await this.clearPlans(folder)
    if (h.rmdir && (await h.stat(folder))) await h.rmdir(folder)
    await h.flush(folder, true)
    if (await h.stat(marker)) await h.remove(marker)
    await h.flush(marker, true)
  }
}
