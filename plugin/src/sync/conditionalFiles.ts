import { EngineError, sha256 } from '@abele/sync-sdk/core'
import { fitGeneratedName } from '@abele/sync-sdk/protocol'

export const CONDITIONAL_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
export const CONDITIONAL_RETENTION_BYTES = 512 * 1024 * 1024
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
  receipt?: boolean
  path: string
  expected: FileVersion | null
  destination: string
  data: string
  kind: ConditionalFileOperation['effect']['kind']
}
export interface ConditionalFileHost {
  checked?: {
    maxBytes: number
    wait(path: string): Promise<void>
    prepareWrite(
      path: string,
      create: boolean
    ): (bytes: Uint8Array, mtime: number) => Promise<boolean>
  }
  root: string
  active: Set<string>
  check(): void
  validate(path: string, recovery?: boolean): void
  stat(path: string): Promise<{ type: string; size: number; mtime: number } | null>
  fingerprint(path: string): Promise<FileVersion>
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

/** Quarantine is retained evidence, never disposable staging or an equality receipt. */
export class ConditionalFiles {
  private maintenance?: { bytes: number; nextExpiry: number }
  constructor(
    private readonly host: ConditionalFileHost,
    private readonly retentionBytes = CONDITIONAL_RETENTION_BYTES
  ) {}
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
      if ((await h.stat(retained + '/victim')) && !(await h.stat(retained + '/ready'))) {
        await h.flush(retained + '/victim')
        await this.flushFormerParent(folder)
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
    if (await h.stat(pointer)) {
      try {
        JSON.parse(new TextDecoder().decode(await h.read(pointer)))
        existing = true
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error
        // A partial pre-move record owns no captured bytes at its destination yet.
        if (await h.stat(retained + '/victim')) throw error
        await h.remove(pointer)
      }
    }
    if (!existing) {
      const at = Date.now()
      try {
        await this.record(pointer, { intent, at })
      } catch (error) {
        this.maintenance = undefined
        throw error
      }
      if (this.maintenance) {
        this.maintenance.bytes += info.size + RETAINED_RECORD_OVERHEAD
        this.maintenance.nextExpiry = Math.min(
          this.maintenance.nextExpiry,
          at + CONDITIONAL_RETENTION_MS
        )
      }
    }
    await h.capture(victim, retained + '/victim')
    await h.flush(retained + '/victim')
    await h.flush(victim, true)
    await this.record(retained + '/ready', true)
  }

  private async sweepRetained(force = false): Promise<void> {
    const h = this.host,
      root = h.root + '/retained'
    if (
      !force &&
      this.maintenance &&
      this.maintenance.bytes <= this.retentionBytes &&
      Date.now() < this.maintenance.nextExpiry
    )
      return
    this.maintenance = undefined
    if (!(await h.stat(root))) {
      this.maintenance = { bytes: 0, nextExpiry: Infinity }
      return
    }
    const records: { id: string; pointer: string; intent: Intent; at: number; size: number }[] = []
    for (const pointer of (await h.list(root)).files) {
      const id = idOf(pointer.slice(root.length + 1).replace(/\.json$/, ''))
      if (h.active.has(h.root + '/' + id)) continue
      let value: { intent: Intent; at: number }
      try {
        value = JSON.parse(new TextDecoder().decode(await h.read(pointer)))
      } catch (error) {
        // Interrupted pre-move metadata is repaired by its source operation.
        if (error instanceof SyntaxError && (await h.stat(h.root + '/objects/' + id + '/victim')))
          continue
        throw error
      }
      if (!value.intent || !Number.isFinite(value.at))
        throw new EngineError('io', 'invalid retained victim record')
      const folder = h.root + '/trash/' + id
      const source = h.root + '/objects/' + id + '/victim'
      if (!(await h.stat(folder + '/victim')) && (await h.stat(source))) {
        await h.mkdir(folder)
        await h.capture(source, folder + '/victim')
        await h.flush(folder + '/victim')
        await this.flushFormerParent(h.root + '/objects/' + id)
      }
      if ((await h.stat(folder + '/victim')) && !(await h.stat(folder + '/ready'))) {
        await h.flush(folder + '/victim')
        await this.flushFormerParent(h.root + '/objects/' + id)
        await this.record(folder + '/ready', true)
      }
      const info = await h.stat(folder + '/victim')
      records.push({ id, pointer, ...value, size: info ? info.size + RETAINED_RECORD_OVERHEAD : 0 })
    }
    records.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    let total = records.reduce((sum, item) => sum + item.size, 0)
    // Trim with headroom instead of walking a full ledger again for each small file.
    const target =
      total > this.retentionBytes
        ? Math.max(
            Math.floor(this.retentionBytes * 0.875),
            Math.min(this.retentionBytes, records.at(-1)?.size ?? 0)
          )
        : this.retentionBytes
    let nextExpiry = Infinity
    for (const item of records) {
      if (item.size && Date.now() - item.at < CONDITIONAL_RETENTION_MS && total <= target) {
        nextExpiry = Math.min(nextExpiry, item.at + CONDITIONAL_RETENTION_MS)
        continue
      }
      const folder = h.root + '/trash/' + item.id,
        victim = folder + '/victim'
      const info = await h.stat(victim)
      if (info) {
        const have = info.type === 'file' ? await h.fingerprint(victim) : null
        const last = await h.stat(victim),
          expected = item.intent.expected
        if (
          !expected ||
          !have ||
          !last ||
          last.type !== 'file' ||
          have.sha !== expected.sha ||
          have.size !== expected.size ||
          Math.round(info.mtime) !== expected.mtime ||
          last.mtime !== info.mtime ||
          last.size !== info.size
        ) {
          h.validate(item.intent.path, true)
          const name = item.intent.path.slice(item.intent.path.lastIndexOf('/') + 1),
            dot = name.lastIndexOf('.')
          const parent = item.intent.path.slice(0, item.intent.path.lastIndexOf('/') + 1)
          const target = fitGeneratedName(
            parent.normalize('NFC'),
            dot > 0 ? name.slice(0, dot) : name,
            dot > 0 ? name.slice(dot) : '',
            ' (Recovered copy ' + item.id + ')'
          )
          await this.restore(victim, target, true)
        }
        // Changed bytes have a durable visible alias before the private alias retires.
        if (await h.stat(victim)) await h.remove(victim)
        await h.flush(victim, true)
      }
      await this.clearPlans(folder)
      if (await h.stat(folder + '/restored')) await h.remove(folder + '/restored')
      if (await h.stat(folder + '/ready')) await h.remove(folder + '/ready')
      if (h.rmdir && (await h.stat(folder))) await h.rmdir(folder)
      await h.flush(folder, true)
      if (await h.stat(item.pointer)) await h.remove(item.pointer)
      await h.flush(item.pointer, true)
      total -= item.size
    }
    this.maintenance = { bytes: total, nextExpiry }
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
  private async restore(from: string, to: string, retained = false) {
    const folder = from.slice(0, from.lastIndexOf('/'))
    if (await this.host.stat(folder + '/restored')) return
    const id = from.split('/').at(-2)
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
    const plans = from.slice(0, from.lastIndexOf('/')) + '/restore-plans'
    const finish = async (destination: string, durable = false) => {
      if (!durable) await this.host.flush(destination)
      if (retained) await this.record(folder + '/restored', true)
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
  async apply(op: ConditionalFileOperation): Promise<boolean> {
    const h = this.host
    h.check()
    h.validate(op.path)
    if (op.effect.kind === 'move') h.validate(op.effect.to)
    await this.sweepRetained()
    if (!h.sameObject && h.checked) return this.applyChecked(op)
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
          if (removed) await this.discard(id)
          return removed
        }
        await h.flush(victim)
        await h.flush(op.path, true)
        const info = await h.stat(victim)
        const have = info?.type === 'file' ? await h.fingerprint(victim) : null
        if (
          !have ||
          have.size !== op.expected.size ||
          Math.max(0, Math.round(info.mtime)) !== op.expected.mtime ||
          have.sha !== op.expected.sha
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
      // A completed marker is durable before the operation leaves the recovery queue.
      await this.record(folder + '/complete', true)
      await this.retireVictim(folder, intent)
      await this.archive(folder, id, true)
      if (!intent.receipt) await this.discard(id)
      if (op.effect.kind === 'move') {
        h.changed([op.path], null)
        h.changed([op.effect.to], 'file')
      } else h.changed([op.path], op.effect.kind === 'remove' ? null : 'file')
      return true
    } catch (error) {
      // Capture itself may have reached disk before its acknowledgement was lost.
      if (recorded) await restore()
      throw error
    } finally {
      h.active.delete(activeKey)
    }
  }
  /** Content decision plus a pending-save/stat fence; no object-identity claim. */
  private async applyChecked(op: ConditionalFileOperation): Promise<boolean> {
    const h = this.host,
      checked = h.checked
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
    let recorded = false
    try {
      if (await h.stat(folder)) return false
      let payload: Uint8Array | undefined
      let mtime = 0
      if (op.effect.kind === 'write') {
        payload = op.effect.bytes
        mtime = op.effect.mtime
      } else if (op.effect.kind === 'install') {
        const stage = await h.stage(op.effect.stageId)
        if (stage.target !== op.path) throw new EngineError('conflict', 'stage target changed')
        if (stage.sealed.size > checked.maxBytes) return false
        payload = await h.read(stage.path)
        if (payload.length !== stage.sealed.size || (await sha256(payload)) !== stage.sealed.sha)
          throw new EngineError('conflict', 'sealed stage changed')
        mtime = (await h.stat(stage.path))?.mtime ?? 0
      }
      if (payload && payload.length > checked.maxBytes) return false
      const publish = payload ? checked.prepareWrite(op.path, op.expected === null) : undefined
      const destination = op.effect.kind === 'move' ? op.effect.to : op.path
      const parent = destination.slice(0, Math.max(0, destination.lastIndexOf('/')))
      if (parent) await h.mkdir(parent)
      const first = await h.stat(op.path)
      if (first && (first.type !== 'file' || first.size > checked.maxBytes)) return false
      if (op.expected && first === null && op.effect.kind === 'remove') {
        await checked.wait(op.path)
        return (await h.stat(op.path)) === null
      }
      if (op.expected === null ? first !== null : first === null) return false
      if (op.expected) {
        const have = await observe(op.path)
        if (!have || have.sha !== op.expected.sha || have.size !== op.expected.size) return false
      }
      const intent: Intent = {
        checked: true,
        receipt: op.effect.kind === 'write' && op.effect.receipt !== undefined,
        path: op.path,
        expected: op.expected && { ...op.expected, mtime: Math.max(0, Math.round(first.mtime)) },
        destination,
        data: victim,
        kind: op.effect.kind,
      }
      await h.mkdir(folder)
      await this.record(folder + '/intent.json', intent)
      await h.mkdir(h.root + '/active')
      await this.record(h.root + '/active/' + id + '.json', intent)
      recorded = true
      await checked.wait(op.path)
      if (destination !== op.path) await checked.wait(destination)
      const last = await h.stat(op.path)
      if (
        first === null
          ? last !== null
          : !last || last.type !== 'file' || last.size !== first.size || last.mtime !== first.mtime
      ) {
        console.debug('[abele-sync] conditional file changed locally; retry later', op.path)
        // No public mutation was attempted; this intent owns no retained user bytes.
        await this.record(folder + '/complete', true)
        await this.archive(folder, id, true)
        await this.discard(id)
        return false
      }
      h.check()
      if (op.expected) {
        await h.capture(op.path, victim)
        // A save at capture itself still belongs to the user, even with unchanged stat.
        const info = await h.stat(victim)
        const have = info?.type === 'file' ? await observe(victim) : null
        if (
          !have ||
          !info ||
          have.sha !== op.expected.sha ||
          have.size !== op.expected.size ||
          info.mtime !== first.mtime
        ) {
          await this.restore(victim, op.path)
          await this.archive(folder, id, false)
          return false
        }
      }
      if (publish) {
        if (op.expected && (await h.stat(op.path))) {
          await this.restore(victim, op.path)
          await this.archive(folder, id, false)
          return false
        }
        if (!(await publish(payload, mtime))) {
          await this.restore(victim, op.path)
          await this.archive(folder, id, false)
          return false
        }
      } else if (op.effect.kind === 'move' && !(await this.install(victim, destination))) {
        await this.restore(victim, op.path)
        await this.archive(folder, id, false)
        return false
      }
      await this.record(folder + '/complete', true)
      await this.retireVictim(folder, intent)
      await this.archive(folder, id, true)
      if (!intent.receipt) await this.discard(id)
      h.changed([op.path], op.effect.kind === 'remove' || op.effect.kind === 'move' ? null : 'file')
      if (op.effect.kind === 'move') h.changed([destination], 'file')
      return true
    } catch (error) {
      if (recorded) await this.restore(victim, op.path)
      if (
        (error as { code?: string })?.code === 'EEXIST' ||
        /^(EEXIST\b|File already exists|Destination file already exists)/.test(
          (error as Error)?.message ?? ''
        )
      ) {
        if (recorded) await this.archive(folder, id, false)
        return false
      }
      throw error
    } finally {
      h.active.delete(key)
    }
  }
  async recover(): Promise<void> {
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
      await this.sweepRetained(true)
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
            if (!intent.receipt) await this.discard(id)
            continue
          }
          if ((await h.stat(folder + '/intent.json')) === null) {
            // No capture was authorized before this file existed.
            await this.archive(folder, id, false)
            continue
          }
          const intent = JSON.parse(
            new TextDecoder().decode(await h.read(folder + '/intent.json'))
          ) as Intent
          h.validate(intent.path)
          h.check()
          await this.restore(folder + '/victim', intent.path)
          await this.archive(folder, id, false)
          h.changed([intent.path])
        } catch (error) {
          // Keep this pointer outstanding, but do not strand independent victims.
          failed ??= error
          console.debug('[abele-sync] conditional recovery remains pending', pointer, error)
        } finally {
          h.active.delete(activeKey)
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
      if (await h.stat(folder + '/intent.json')) {
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
      folder + '/intent.json',
      h.root + '/completed/' + id + '.json',
      h.root + '/active/' + id + '.json',
      h.root + '/review/' + id + '.json',
    ]) {
      if (await h.stat(path)) await h.remove(path)
    }
    await this.clearPlans(folder)
    if (h.rmdir && (await h.stat(folder))) await h.rmdir(folder)
    await h.flush(folder, true)
    if (await h.stat(marker)) await h.remove(marker)
    await h.flush(marker, true)
  }
}
