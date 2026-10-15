import { z } from 'zod'
import { EngineError } from '@abele/sync-core'
import type { LocalStorage } from './ledgerId'

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
    private readonly adapter: DirectoryAdapter,
    private readonly storage: LocalStorage,
    private readonly symlink: (path: string) => Promise<boolean> = async () => false,
    private readonly removeEmpty: (path: string) => Promise<void> = (path) =>
      adapter.rmdir(path, false)
  ) {}
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
    if (depth > 32) throw new EngineError('io', 'Directory tree is too deep')
    const children = await this.adapter.list(path)
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
      const stat = await this.adapter.stat(child)
      if (stat?.type !== 'folder') continue
      const nested = await this.tree(child, depth + 1)
      files.push(...nested.files)
      folders.push(...nested.folders, { path: child, birth: stat.ctime })
    }
    return { files, folders }
  }
  private async reconcile(): Promise<void> {
    for (const pending of this.removals().sort((a, b) => b.path.length - a.path.length)) {
      const drop = () =>
        this.saveRemovals(this.removals().filter((one) => one.path !== pending.path))
      const stat = await this.adapter.stat(pending.path)
      if (
        stat?.type !== 'folder' ||
        stat.ctime !== pending.birth ||
        (await this.symlink(pending.path))
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
        const current = await this.adapter.stat(folder.path)
        if (current?.type !== 'folder' || current.ctime !== folder.birth) continue
        const children = await this.adapter.list(folder.path)
        if (children.files.length || children.folders.length) continue
        try {
          await this.removeEmpty(folder.path)
        } catch (error) {
          if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes((error as { code?: string }).code ?? ''))
            throw error
        }
      }
      if (!(await this.adapter.stat(pending.path))) drop()
    }
  }
  /** Only retry a requested departure, never prune unrelated deliberately empty folders. */
  async removedChild(path: string): Promise<void> {
    for (const pending of this.removals().sort((a, b) => b.path.length - a.path.length)) {
      if (!path.startsWith(pending.path + '/')) continue
      const stat = await this.adapter.stat(pending.path)
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
  async *list(): AsyncIterable<{ path: string; identity: string; mtime: number }> {
    await this.reconcile()
    const found: { path: string; birth: number; mtime: number }[] = []
    const walk = async (path: string, depth: number) => {
      if (depth > 32) throw new EngineError('io', 'Directory tree is too deep')
      for (const folder of (await this.adapter.list(path)).folders) {
        if (
          ['.abele-sync', '.trash', '.git'].some(
            (root) => folder === root || folder.startsWith(root + '/')
          ) ||
          (await this.symlink(folder))
        )
          continue
        const stat = await this.adapter.stat(folder)
        if (stat?.type !== 'folder') continue
        found.push({ path: folder, birth: stat.ctime, mtime: Math.max(0, Math.round(stat.mtime)) })
        await walk(folder, depth + 1)
      }
    }
    await walk('', 0)
    const old = this.records(),
      occupied = new Set(found.map((one) => one.path))
    const records = found.map((one) => {
      const same = old.find((record) => record.path === one.path && record.birth === one.birth)
      const renamed = old.filter(
        (record) => !occupied.has(record.path) && record.birth === one.birth
      )
      // Offline rename recovery is accepted only with unique birth evidence on both sides.
      const recovered =
        renamed.length === 1 && found.filter((other) => other.birth === one.birth).length === 1
          ? renamed[0]
          : null
      return {
        path: one.path,
        birth: one.birth,
        identity: (same ?? recovered)?.identity ?? crypto.randomUUID(),
      }
    })
    this.save(records)
    const removals = this.removals()
    for (const one of found) {
      // A departed folder awaiting a held child must not be published as a new mkdir.
      if (
        removals.some(
          (pending) =>
            (pending.path === one.path && pending.birth === one.birth) ||
            one.path.startsWith(pending.path + '/')
        )
      )
        continue
      yield {
        path: one.path,
        identity: records.find((record) => record.path === one.path).identity,
        mtime: one.mtime,
      }
    }
  }
  async mkdir(path: string): Promise<void> {
    const before = await this.adapter.stat(path)
    if (before) {
      if (before.type !== 'folder' || (await this.symlink(path)))
        throw new EngineError('conflict', 'Directory path is occupied')
      this.saveRemovals(this.removals().filter((one) => one.path !== path))
      return
    }
    await this.adapter.mkdir(path)
    this.saveRemovals(this.removals().filter((one) => one.path !== path))
  }
  /** A received directory needs only its own identity, not another walk of the vault. */
  async identity(path: string): Promise<string> {
    const stat = await this.adapter.stat(path)
    if (stat?.type !== 'folder' || (await this.symlink(path)))
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
    if (await this.adapter.stat(to))
      throw new EngineError('conflict', 'Directory destination is occupied')
    if ((await this.symlink(from)) || (await this.adapter.stat(from))?.type !== 'folder')
      throw new EngineError('conflict', 'Directory source is unavailable')
    await this.adapter.rename(from, to)
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
  async remove(path: string): Promise<void> {
    const stat = await this.adapter.stat(path)
    if (!stat) {
      this.saveRemovals(this.removals().filter((one) => one.path !== path))
      return
    }
    if (stat.type !== 'folder' || (await this.symlink(path)))
      throw new EngineError('conflict', 'Directory path is occupied')
    const children = await this.adapter.list(path)
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
