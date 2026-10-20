import { assertPhysicalPath } from './external/projection'
import { withinSyncPath } from './scope'
import { crossesSymlink } from './symlinkChain'
import { z } from 'zod'
import { EngineError } from '@abele/sync-sdk/core'
import type { LocalStorage } from './ledgerId'

import { assertNoLinkedAncestors } from './vaultPathLinks'

const KEY = 'abele-sync-local-directories-v1'
const REMOVALS = 'abele-sync-empty-directory-removals-v1'
const removalSchema = z.array(
  z.object({ path: z.string(), birth: z.number(), files: z.array(z.string()).optional() }).strict()
)
const schema = z.array(
  z.object({ path: z.string(), identity: z.string().min(1), birth: z.number() }).strict()
)
interface DirectoryAdapter {
  stat(path: string): Promise<{ type: string; ctime: number; mtime: number; size: number } | null>
  list(path: string): Promise<{ files: string[]; folders: string[] }>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  rmdir(path: string, recursive: boolean): Promise<void>
}
/** Device-local identities and strictly nonrecursive directory effects. */
export class VaultDirectories {
  constructor(
    private readonly disk: DirectoryAdapter,
    private readonly storage: LocalStorage,
    private readonly symlink: (path: string) => Promise<boolean> = async () => false,
    private readonly removeEmpty: (path: string) => Promise<void> = (path) =>
      disk.rmdir(path, false),
    private readonly scope: (() => string | undefined) | readonly string[] = () => undefined
  ) {}
  private includes(path: string): boolean {
    const roots = typeof this.scope === 'function' ? [this.scope()] : this.scope
    if (roots.some((root) => !root || root === '/')) return true
    try {
      assertPhysicalPath(path)
    } catch {
      return false
    }
    return roots.some((root) => root && (path === root || path.startsWith(root + '/')))
  }
  private assertPath(path: string): void {
    if (!this.includes(path))
      throw new EngineError('protocol', 'Directory path is outside this connection')
  }
  /** The path or any ancestor up to the vault root is a symlink: never the vault's to touch. */
  private linked(path: string, seen?: Map<string, Promise<boolean | null>>): Promise<boolean> {
    return crossesSymlink(path, this.symlink, seen)
  }
  private records() {
    return schema.parse(this.storage.loadLocalStorage(KEY) ?? [])
  }
  private save(records: z.infer<typeof schema>) {
    this.storage.saveLocalStorage(KEY, records)
    if (JSON.stringify(this.storage.loadLocalStorage(KEY)) !== JSON.stringify(records))
      throw new Error('Local directory identity was not stored')
  }
  private removals() {
    return removalSchema.parse(this.storage.loadLocalStorage(REMOVALS) ?? [])
  }
  private saveRemovals(removals: z.infer<typeof removalSchema>) {
    this.storage.saveLocalStorage(REMOVALS, removals)
    if (JSON.stringify(this.storage.loadLocalStorage(REMOVALS)) !== JSON.stringify(removals))
      throw new Error('Pending empty-directory removal was not stored')
  }
  private async tree(
    path: string,
    depth = 0
  ): Promise<{ files: string[]; folders: { path: string; birth: number }[] }> {
    this.assertPath(path)
    if (depth > 32) throw new EngineError('io', 'Directory tree is too deep')
    const children = await this.disk.list(path)
    for (const child of [...children.files, ...children.folders]) this.assertPath(child)
    const files = [...children.files]
    const folders: { path: string; birth: number }[] = []
    for (const child of children.folders) {
      // Never follow/remove a symlink or a protected directory as empty content.
      if (
        (await this.symlink(child)) ||
        /(?:^|\/)(?:\.git|\.trash|\.abele-sync)(?:\/|$)/.test(child)
      ) {
        files.push(child)
        continue
      }
      const stat = await this.disk.stat(child)
      if (stat?.type !== 'folder') continue
      const nested = await this.tree(child, depth + 1)
      files.push(...nested.files)
      folders.push(...nested.folders, { path: child, birth: stat.ctime })
    }
    return { files, folders }
  }
  private async reconcile(): Promise<void> {
    for (const pending of this.removals().sort((a, b) => b.path.length - a.path.length)) {
      if (!this.includes(pending.path)) continue
      const drop = () =>
        this.saveRemovals(this.removals().filter((one) => one.path !== pending.path))
      await assertNoLinkedAncestors(pending.path, this.symlink)
      const stat = await this.disk.stat(pending.path)
      if (
        stat?.type !== 'folder' ||
        stat.ctime !== pending.birth ||
        (await this.linked(pending.path))
      ) {
        drop()
        continue
      }
      const tree = await this.tree(pending.path)
      // New local content supersedes the remote departure. Legacy intents have no
      // baseline, so conservatively publish their surviving content too.
      const originalFiles = new Set(pending.files ?? [])
      if (tree.files.some((path) => !originalFiles.has(path))) {
        drop()
        continue
      }
      if (tree.files.length) continue
      for (const folder of [...tree.folders, { path: pending.path, birth: pending.birth }]) {
        await assertNoLinkedAncestors(folder.path, this.symlink)
        const current = await this.disk.stat(folder.path)
        if (current?.type !== 'folder' || current.ctime !== folder.birth) continue
        const children = await this.disk.list(folder.path)
        if (children.files.length || children.folders.length) continue
        try {
          await this.removeEmpty(folder.path)
        } catch (error) {
          if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes((error as { code?: string }).code ?? ''))
            throw error
        }
      }
      if (!(await this.disk.stat(pending.path))) drop()
    }
  }
  /** Only retry a requested departure, never prune unrelated deliberately empty folders. */
  async removedChild(path: string): Promise<void> {
    if (!this.includes(path)) return
    for (const pending of this.removals().sort((a, b) => b.path.length - a.path.length)) {
      if (!this.includes(pending.path)) continue
      if (
        path.normalize('NFC') === pending.path.normalize('NFC') ||
        !withinSyncPath(path, pending.path)
      )
        continue
      const stat = await this.disk.stat(pending.path)
      if (!stat || stat.ctime !== pending.birth) {
        this.saveRemovals(this.removals().filter((one) => one.path !== pending.path))
        continue
      }
      try {
        await this.remove(pending.path)
      } catch (error) {
        if ((error as { code?: string }).code !== 'ENOTEMPTY') throw error
      }
    }
  }
  /**
   * `indexed` lists the folders to inventory instead of walking the vault; `within` bounds
   * that inventory to one connection's subtree. Identities outside it belong to other
   * connections sharing this device storage: they are kept as they are and not read.
   */
  async *list(
    indexed?: readonly string[],
    within?: (path: string) => boolean
  ): AsyncIterable<{ path: string; identity: string; mtime: number }> {
    await this.reconcile()
    const found: { path: string; birth: number; mtime: number }[] = []
    const outside = indexed && within ? this.records().filter((one) => !within(one.path)) : []
    const outsidePaths = new Set(outside.map((one) => one.path))
    const walk = async (path: string, depth: number) => {
      if (depth > 32) throw new EngineError('io', 'Directory tree is too deep')
      for (const folder of (await this.disk.list(path)).folders) {
        if (
          !this.includes(folder) ||
          ['.abele-sync', '.trash', '.git'].some(
            (root) => folder === root || folder.startsWith(root + '/')
          ) ||
          (await this.symlink(folder))
        )
          continue
        const stat = await this.disk.stat(folder)
        if (stat?.type !== 'folder') continue
        found.push({ path: folder, birth: stat.ctime, mtime: Math.max(0, Math.round(stat.mtime)) })
        await walk(folder, depth + 1)
      }
    }
    if (indexed) {
      const seen = new Map<string, Promise<boolean | null>>()
      for (const path of indexed) {
        if (!this.includes(path)) continue
        if (await this.linked(path, seen)) continue
        const stat = await this.disk.stat(path)
        if (stat?.type === 'folder')
          found.push({ path, birth: stat.ctime, mtime: Math.max(0, Math.round(stat.mtime)) })
      }
      // The index lags behind folders a pull just made. A remembered folder still standing
      // with the same birth keeps its identity rather than being forgotten and re-minted.
      const listed = new Set(found.map((one) => one.path))
      for (const record of this.records()) {
        if (!this.includes(record.path) || listed.has(record.path) || outsidePaths.has(record.path))
          continue
        // Only ordinary vault folders lag the index; a hidden one was never in this inventory.
        if (record.path.split('/').some((part) => part.startsWith('.'))) continue
        if (await this.linked(record.path, seen)) continue
        const stat = await this.disk.stat(record.path)
        if (stat?.type === 'folder' && stat.ctime === record.birth) {
          listed.add(record.path)
          found.push({
            path: record.path,
            birth: stat.ctime,
            mtime: Math.max(0, Math.round(stat.mtime)),
          })
        }
      }
    } else {
      const roots = typeof this.scope === 'function' ? [this.scope()] : this.scope
      for (const root of roots) {
        if (root && root !== '/') {
          this.assertPath(root)
          await assertNoLinkedAncestors(root, this.symlink)
          const stat = await this.disk.stat(root)
          if (stat?.type === 'folder') {
            found.push({
              path: root,
              birth: stat.ctime,
              mtime: Math.max(0, Math.round(stat.mtime)),
            })
            await walk(root, 0)
          }
        } else await walk('', 0)
      }
    }
    const all = this.records(),
      old = all.filter((record) => this.includes(record.path) && !outsidePaths.has(record.path)),
      occupied = new Set(found.map((one) => one.path))
    const records = found.map((one) => {
      const same = old.find((record) => record.path === one.path && record.birth === one.birth)
      const renamed = old.filter(
        (record) => !occupied.has(record.path) && record.birth === one.birth
      )
      // Offline rename recovery is accepted only with unique birth evidence on both sides.
      const normalized = renamed.filter(
        (record) => record.path.normalize('NFC') === one.path.normalize('NFC')
      )
      const normalizedUnique =
        normalized.length === 1 &&
        found.filter((other) => other.path.normalize('NFC') === one.path.normalize('NFC'))
          .length === 1
      const recovered = normalizedUnique
        ? normalized[0]
        : renamed.length === 1 && found.filter((other) => other.birth === one.birth).length === 1
          ? renamed[0]
          : null
      return {
        path: one.path,
        birth: one.birth,
        identity: (same ?? recovered)?.identity ?? crypto.randomUUID(),
      }
    })
    this.save([
      ...all.filter((one) => !this.includes(one.path) || outsidePaths.has(one.path)),
      ...records,
    ])
    const identities = new Map(records.map((record) => [record.path, record.identity]))
    const removals = this.removals().filter((one) => this.includes(one.path))
    for (const one of found) {
      // A departed folder awaiting a held child must not be published as a new mkdir.
      if (
        removals.some(
          (pending) =>
            (pending.path.normalize('NFC') === one.path.normalize('NFC') &&
              pending.birth === one.birth) ||
            (one.path.normalize('NFC') !== pending.path.normalize('NFC') &&
              withinSyncPath(one.path, pending.path))
        )
      )
        continue
      yield {
        path: one.path,
        identity: identities.get(one.path),
        mtime: one.mtime,
      }
    }
  }
  async mkdir(path: string): Promise<void> {
    if (await this.linked(path))
      throw new EngineError('conflict', 'Directory path contains a symbolic link')
    this.assertPath(path)
    const before = await this.disk.stat(path)
    if (await this.linked(path)) throw new EngineError('conflict', 'Directory path is occupied')
    if (before) {
      if (before.type !== 'folder') throw new EngineError('conflict', 'Directory path is occupied')
      this.saveRemovals(this.removals().filter((one) => one.path !== path))
      return
    }
    await this.disk.mkdir(path)
    this.saveRemovals(this.removals().filter((one) => one.path !== path))
  }
  /** A received directory needs only its own identity, not another walk of the vault. */
  async identity(path: string): Promise<string> {
    this.assertPath(path)
    const stat = await this.disk.stat(path)
    if (stat?.type !== 'folder' || (await this.linked(path)))
      throw new EngineError('io', 'Received directory is unavailable')
    const records = this.records()
    const same = records.find((one) => one.path === path && one.birth === stat.ctime)
    if (same) return same.identity
    const identity = crypto.randomUUID()
    this.save([
      ...records.filter((one) => one.path !== path),
      { path, birth: stat.ctime, identity },
    ])
    return identity
  }
  async move(from: string, to: string): Promise<void> {
    if ((await this.linked(from)) || (await this.linked(to)))
      throw new EngineError('conflict', 'Directory path contains a symbolic link')
    this.assertPath(from)
    this.assertPath(to)
    if (await this.disk.stat(to))
      throw new EngineError('conflict', 'Directory destination is occupied')
    if (await this.linked(to))
      throw new EngineError('conflict', 'Directory destination is occupied')
    if ((await this.linked(from)) || (await this.disk.stat(from))?.type !== 'folder')
      throw new EngineError('conflict', 'Directory source is unavailable')
    await this.disk.rename(from, to)
    this.renamed(from, to)
  }
  renamed(from: string, to: string): void {
    this.save(
      this.records().map((one) =>
        one.path === from || one.path.startsWith(from + '/')
          ? { ...one, path: to + one.path.slice(from.length) }
          : one
      )
    )
  }
  async remove(path: string, expectedIdentity?: string): Promise<void> {
    if (await this.linked(path))
      throw new EngineError('conflict', 'Directory path contains a symbolic link')
    this.assertPath(path)
    const stat = await this.disk.stat(path)
    if (!stat) {
      this.saveRemovals(this.removals().filter((one) => one.path !== path))
      return
    }
    if (stat.type !== 'folder' || (await this.linked(path)))
      throw new EngineError('conflict', 'Directory path is occupied')
    if (expectedIdentity !== undefined && (await this.identity(path)) !== expectedIdentity)
      throw new EngineError('conflict', 'Directory identity changed before removal')
    const children = await this.disk.list(path)
    if (children.files.length || children.folders.length) {
      const prior = this.removals().find((one) => one.path === path && one.birth === stat.ctime)
      this.saveRemovals([
        ...this.removals().filter((one) => one.path !== path),
        prior ?? { path, birth: stat.ctime, files: (await this.tree(path)).files },
      ])
      // Core forgets ENOTEMPTY removals; retain the intent until held children depart.
      throw Object.assign(new Error('Directory is not empty'), { code: 'ENOTEMPTY' })
    }
    await this.removeEmpty(path)
    this.save(this.records().filter((one) => one.path !== path))
    this.saveRemovals(this.removals().filter((one) => one.path !== path))
    await this.removedChild(path)
  }
}
