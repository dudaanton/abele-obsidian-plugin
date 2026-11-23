import { vaultDisk } from './vaultPathLinks'
import { durableHostOf, flushHostStorage, hostStorageOf } from './hostSyncStorage'
import { SerialQueue } from './queue'
import type { App, TFile } from 'obsidian'
import { z } from 'zod'
import { markdownLinkTargets } from '@/helpers/markdownLinkTargets'
import type { ConsentTarget } from './attachmentConsent'

const KEY = 'abele-token-local-files-v1'
const records = z.array(z.object({ id: z.uuid(), path: z.string(), birth: z.number() }))
/** Local identities never confer remote read or publication authority. */
export class TokenAttachmentHost {
  private readonly writes = new SerialQueue()

  private persist<T>(work: () => T | Promise<T>): Promise<T> {
    return this.writes.run(async () => {
      const store = durableHostOf(this.app)
      // Rebuild from committed rows, never from a draft left by a failed commit.
      await store?.readValue(KEY)
      try {
        const result = await work()
        const expected = this.rows()
        await flushHostStorage(this.app)
        const committed = records.parse(store ? ((await store.readValue(KEY)) ?? []) : this.rows())
        if (JSON.stringify(committed) !== JSON.stringify(expected))
          throw new Error('Local file identities were not committed')
        return result
      } catch (error) {
        // A failed write must not leave a draft that a retry mistakes for persistence.
        await store?.readValue(KEY).catch(() => {})
        throw error
      }
    })
  }

  constructor(
    private readonly app: App,
    private readonly offloaded: (path: string) => boolean = () => false
  ) {}
  async remember(path: string): Promise<void> {
    await this.persist(() => {
      const file = this.app.vault.getFileByPath(path)
      if (file) this.identity(file)
    })
  }
  async hydrated(path: string): Promise<void> {
    await this.persist(() => {
      const file = this.app.vault.getFileByPath(path)
      if (file)
        this.save(
          this.rows().map((row) => (row.path === path ? { ...row, birth: file.stat.ctime } : row))
        )
    })
  }
  private rows() {
    return records.parse(hostStorageOf(this.app).loadLocalStorage(KEY) ?? [])
  }
  private save(rows: z.infer<typeof records>) {
    hostStorageOf(this.app).saveLocalStorage(KEY, rows)
    if (JSON.stringify(this.rows()) !== JSON.stringify(rows))
      throw new Error('Local file identities were not stored')
  }
  private identity(file: TFile): string {
    const rows = this.rows(),
      prior = rows.find((one) => one.path === file.path && one.birth === file.stat.ctime)
    if (prior) return prior.id
    const id = crypto.randomUUID()
    this.save([
      ...rows.filter((one) => one.path !== file.path),
      { id, path: file.path, birth: file.stat.ctime },
    ])
    return id
  }
  async renamed(from: string, to: string): Promise<void> {
    await this.persist(() =>
      this.save(
        this.rows().map((one) =>
          one.path === from || one.path.startsWith(from + '/')
            ? { ...one, path: to + one.path.slice(from.length) }
            : one
        )
      )
    )
  }
  resolve(id: string): ConsentTarget | null {
    const row = this.rows().find((one) => one.id === id),
      file = row && this.app.vault.getFileByPath(row.path)
    if (!row || (!file && !this.offloaded(row.path)) || (file && file.stat.ctime !== row.birth))
      return null
    const path = file?.path ?? row.path,
      extension = path.split('.').at(-1)
    return {
      id,
      path,
      kind: extension === 'md' ? 'note' : extension === 'canvas' ? 'canvas' : 'attachment',
    }
  }
  note(path: string): Promise<{ id: string; targets: ConsentTarget[] } | null> {
    return this.persist(() => this.inspectNote(path))
  }
  private async inspectNote(
    path: string
  ): Promise<{ id: string; targets: ConsentTarget[] } | null> {
    const file = this.app.vault.getFileByPath(path)
    if (!file || file.extension !== 'md') return null
    const text = await vaultDisk(this.app.vault).read(path)
    const links = [...text.matchAll(/\[\[([^\]|#]+)(?:[^\]]*)\]\]/g)].map((one) => one[1])
    for (const one of markdownLinkTargets(text)) links.push(text.slice(one.start, one.end))
    const targets = new Map<string, ConsentTarget>()
    for (const link of links) {
      const target = this.app.metadataCache.getFirstLinkpathDest(link, file.path)
      if (!target || target.extension === 'md') continue
      const id = this.identity(target),
        resolved = this.resolve(id)
      if (resolved) targets.set(id, resolved)
    }
    const id = this.identity(file)
    return { id, targets: [...targets.values()] }
  }
}
