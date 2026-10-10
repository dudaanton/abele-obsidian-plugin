import type { App, TFile } from 'obsidian'
import { z } from 'zod'
import { markdownLinkTargets } from '@/helpers/markdownLinkTargets'
import type { ConsentTarget } from './attachmentConsent'

const KEY = 'abele-token-local-files-v1'
const records = z.array(z.object({ id: z.uuid(), path: z.string(), birth: z.number() }))
/** Local identities never confer remote read or publication authority. */
export class TokenAttachmentHost {
  constructor(private readonly app: App) {}
  private rows() {
    return records.parse(this.app.loadLocalStorage(KEY) ?? [])
  }
  private save(rows: z.infer<typeof records>) {
    this.app.saveLocalStorage(KEY, rows)
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
  renamed(from: string, to: string): void {
    this.save(
      this.rows().map((one) =>
        one.path === from || one.path.startsWith(from + '/')
          ? { ...one, path: to + one.path.slice(from.length) }
          : one
      )
    )
  }
  resolve(id: string): ConsentTarget | null {
    const row = this.rows().find((one) => one.id === id),
      file = row && this.app.vault.getFileByPath(row.path)
    if (!row || !file || file.stat.ctime !== row.birth) return null
    return {
      id,
      path: file.path,
      kind:
        file.extension === 'md' ? 'note' : file.extension === 'canvas' ? 'canvas' : 'attachment',
    }
  }
  async note(path: string): Promise<{ id: string; targets: ConsentTarget[] } | null> {
    const file = this.app.vault.getFileByPath(path)
    if (!file || file.extension !== 'md') return null
    const text = await this.app.vault.read(file)
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
    return { id: this.identity(file), targets: [...targets.values()] }
  }
}
