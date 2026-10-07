import { TFile, TFolder, normalizePath, type App } from 'obsidian'
import { COMMENT_ID_RE } from '@/editor/commentMarkers'
import { decodeThread, encodeThread, type CommentThread } from './model'
import type { CommentDocuments, CommentRepository, ThreadSnapshot } from './service'

/** One instance per vault. Own writes are serialized; vault.process checks external revisions. */
export class VaultCommentRepository implements CommentRepository {
  private readonly writers = new Map<string, Promise<unknown>>()
  constructor(
    private readonly app: App,
    private readonly folder: () => string
  ) {}

  path(id: string): string {
    if (!COMMENT_ID_RE.test(id)) throw new Error('Invalid comment id')
    return normalizePath(`${this.folder()}/${id}.abcomment`)
  }
  async ids(): Promise<string[]> {
    return this.app.vault
      .getFiles()
      .filter((file) => file.extension === 'abcomment' && file.path === this.path(file.basename))
      .map((file) => file.basename)
  }
  async occupied(id: string): Promise<boolean> {
    return (
      !!this.app.vault.getAbstractFileByPath(this.path(id)) ||
      !!this.app.vault.getAbstractFileByPath(this.path(id).replace(/\.abcomment$/, '.abchat'))
    )
  }
  async read(id: string): Promise<ThreadSnapshot | null> {
    const file = this.app.vault.getAbstractFileByPath(this.path(id))
    if (!(file instanceof TFile)) return null
    const revision = await this.app.vault.read(file)
    return { thread: decodeThread(revision, id), revision }
  }
  private async own<T>(id: string, action: () => Promise<T>): Promise<T> {
    const previous = this.writers.get(id) ?? Promise.resolve()
    const task = previous.catch(() => {}).then(action)
    this.writers.set(id, task)
    try {
      return await task
    } finally {
      if (this.writers.get(id) === task) this.writers.delete(id)
    }
  }
  async write(thread: CommentThread, expected: string | null): Promise<ThreadSnapshot> {
    const revision = encodeThread(thread)
    return this.own(thread.id, async () => {
      const path = this.path(thread.id)
      if (expected === null) {
        await this.ensureFolder()
        if (await this.occupied(thread.id)) throw new Error('The comment id is already in use')
        await this.app.vault.create(path, revision)
      } else {
        const file = this.app.vault.getAbstractFileByPath(path)
        if (!(file instanceof TFile)) throw new Error('The comment file is unavailable')
        await this.app.vault.process(file, (current) => {
          if (current !== expected)
            throw new Error('The comment changed elsewhere. Reopen it before saving')
          return revision
        })
      }
      return { thread: decodeThread(revision, thread.id), revision }
    })
  }
  async remove(id: string, expected: string): Promise<void> {
    return this.own(id, async () => {
      const file = this.app.vault.getAbstractFileByPath(this.path(id))
      if (!(file instanceof TFile)) throw new Error('The comment file is unavailable')
      await this.app.vault.process(file, (current) => {
        if (current !== expected)
          throw new Error('The comment changed elsewhere. Reopen it before deleting')
        return current
      })
      await this.app.vault.trash(file, true)
    })
  }
  private async ensureFolder(): Promise<void> {
    const parts = normalizePath(this.folder()).split('/')
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/')
      if (this.app.vault.getAbstractFileByPath(path) instanceof TFolder) continue
      try {
        await this.app.vault.createFolder(path)
      } catch (error) {
        if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) throw error
      }
    }
  }
}

export function vaultCommentDocuments(app: App): CommentDocuments {
  return {
    async change(path, transform) {
      const file = app.vault.getAbstractFileByPath(path)
      if (!(file instanceof TFile) || file.extension !== 'md')
        throw new Error('The note is unavailable')
      await app.vault.process(file, transform)
    },
  }
}
