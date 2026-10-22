import { EngineError } from '@abele/sync-sdk/core'
import { fitGeneratedName } from '@abele/sync-sdk/protocol'

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
  path: string
  expected: FileVersion | null
  destination: string
  data: string
  kind: ConditionalFileOperation['effect']['kind']
}
export interface ConditionalFileHost {
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
  changed(paths: string[]): void
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
  constructor(private readonly host: ConditionalFileHost) {}
  private async record(path: string, value: unknown) {
    await this.host.create(path, new TextEncoder().encode(JSON.stringify(value)), 0)
    await this.host.flush(path)
  }
  private async install(from: string, to: string): Promise<boolean> {
    try {
      await this.host.install(from, to)
    } catch (error) {
      if ((await this.host.stat(to)) !== null) return false
      throw error
    }
    await this.host.flush(to)
    return true
  }
  private async restore(from: string, to: string) {
    const info = await this.host.stat(from)
    if (!info) return
    this.host.check()
    const id = from.split('/').at(-2)
    let rootFallback = false
    const parents = to.split('/').slice(0, -1)
    for (let end = 1; end <= parents.length; end++) {
      const parent = await this.host.stat(parents.slice(0, end).join('/'))
      if (parent === null) break
      if (parent.type !== 'folder') { rootFallback = true; break }
    }
    for (let attempt = 0; attempt < 16; attempt++) {
      const file = to.slice(to.lastIndexOf('/') + 1), dot = file.lastIndexOf('.')
      const stem = dot > 0 ? file.slice(0, dot) : file, ext = dot > 0 ? file.slice(dot) : ''
      const suffix = ' (Conflicted copy restored ' + (attempt <= 1 ? id : crypto.randomUUID()) + ')'
      let destination = attempt === 0 ? to : to.slice(0, to.lastIndexOf('/') + 1) + stem + suffix + ext
      if (rootFallback) {
        destination = fitGeneratedName('', stem, ext, suffix)
      }
      this.host.validate(destination, rootFallback)
      const parent = destination.slice(0, Math.max(0, destination.lastIndexOf('/')))
      if (parent) await this.host.mkdir(parent)
      if ((await this.host.stat(destination)) !== null) {
        if (info.type === 'file' && (await this.host.sameObject?.(from, destination))) {
          await this.host.flush(destination)
          return
        }
        continue
      }
      if (info.type === 'file') {
        if (!(await this.install(from, destination))) continue
      } else {
        if (!this.host.restoreDirectory)
          throw new EngineError('io', 'directory restoration unavailable')
        try {
          await this.host.restoreDirectory(from, destination)
        } catch (error) {
          if ((await this.host.stat(destination)) !== null) continue
          throw error
        }
        await this.host.flush(destination, true)
        await this.host.flush(from, true)
      }
      this.host.changed([destination])
      return
    }
    throw new EngineError('io', 'visible recovery destinations are occupied')
  }
  private async archive(_folder: string, id: string, successful: boolean) {
    const parent = this.host.root + (successful ? '/completed' : '/review')
    await this.host.mkdir(parent)
    await this.host.capture(this.host.root + '/active/' + id + '.json', parent + '/' + id + '.json')
    await this.host.flush(parent + '/' + id + '.json')
    await this.host.flush(this.host.root + '/active/' + id + '.json', true)
  }
  async apply(op: ConditionalFileOperation): Promise<boolean> {
    const h = this.host
    h.check()
    h.validate(op.path)
    if (op.effect.kind === 'move') h.validate(op.effect.to)
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
        path: op.path,
        expected: op.expected,
        destination: op.effect.kind === 'move' ? op.effect.to : op.path,
        data: op.effect.kind === 'write' ? folder + '/data' : source,
        kind: op.effect.kind,
      }
      await h.mkdir(folder)
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
          await h.capture(op.path, victim)
          captured = true
        } catch (error) {
          if (!missing(error)) throw error
          if ((await h.stat(victim)) !== null) throw error
          const removed = op.effect.kind === 'remove' && (await h.stat(op.path)) === null
          await this.archive(folder, id, removed)
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
      await this.archive(folder, id, true)
      h.changed([op.path, ...(op.effect.kind === 'move' ? [op.effect.to] : [])])
      return true
    } catch (error) {
      // Capture itself may have reached disk before its acknowledgement was lost.
      if (recorded) await restore()
      throw error
    } finally {
      h.active.delete(activeKey)
    }
  }
  async recover(): Promise<void> {
    const h = this.host,
      root = h.root + '/active'
    if ((await h.stat(root)) === null) return
    let failed: unknown
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
          await this.archive(folder, id, true)
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
      return (
        (await h.sameObject(intent.data, path)) &&
        (await h.fingerprint(path)).sha === sha &&
        (await h.sameObject(intent.data, path))
      )
    } catch (error) {
      if (!missing(error)) throw error
    }
    return false
  }
}
