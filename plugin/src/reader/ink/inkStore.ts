/**
 * A PDF's ink in the vault: each page's SVG in the folder beside the book, read when the book opens
 * and again when another device's copy arrives, written a moment after drawing stops; and the
 * page's callout in the book's highlights note, added with the page's first stroke and taken out
 * with its last (`inkFile.ts` has the formats).
 *
 * The files are ordinary vault files, so they go wherever the vault goes — Obsidian Sync, git,
 * anything — and the book's note shows them on a phone without the plugin.
 */
import { TFile, TFolder, normalizePath, type App } from 'obsidian'
import { linkToPlace } from '../bookLinks'
import { companionPath, noteFor, notesOf, type NotesPlace } from '../companion'
import { newHighlightsNote } from '../highlights'
import {
  inkCallout,
  inkFolderOf,
  inkPageOf,
  inkPathOf,
  inkSvg,
  parseInkSvg,
  removeInkCallout,
  upsertInkCallout,
  type InkPage,
} from './inkFile'

export class InkStore {
  /** What was last written to each file, so the vault's news of it is not taken for a change. */
  private readonly written = new Map<string, string>()

  constructor(
    private readonly app: App,
    private readonly book: TFile,
    private readonly where: () => NotesPlace
  ) {}

  /** The page a vault path is the ink of, while the book has the name it has now. */
  pageOf(path: string): number | null {
    return inkPageOf(path, this.book.path)
  }

  /** Every page's ink there is. */
  async readAll(): Promise<Map<number, InkPage>> {
    const out = new Map<number, InkPage>()
    const folder = this.app.vault.getAbstractFileByPath(inkFolderOf(this.book.path))
    if (!(folder instanceof TFolder)) return out
    for (const file of folder.children) {
      if (!(file instanceof TFile)) continue
      const index = this.pageOf(file.path)
      if (index === null) continue
      const page = parseInkSvg(await this.app.vault.read(file))
      if (page) out.set(index, page)
    }
    return out
  }

  /**
   * A page's file as it is now, after the vault said it changed: its ink, or null for a page with
   * none; undefined when it is what this device wrote, or not a page's ink at all.
   */
  async changed(path: string): Promise<InkPage | null | undefined> {
    if (this.pageOf(path) === null) return undefined
    const file = this.app.vault.getAbstractFileByPath(path)
    const text = file instanceof TFile ? await this.app.vault.read(file) : ''
    if (this.written.get(path) === text) return undefined
    this.written.delete(path)
    return text ? parseInkSvg(text) : null
  }

  /** Writes a page's ink; a page left with none has its file and its callout removed. */
  async write(index: number, page: InkPage | undefined): Promise<void> {
    const { vault } = this.app
    const path = inkPathOf(this.book.path, index)
    const existing = vault.getAbstractFileByPath(path)
    if (!page?.strokes.length) {
      if (!(existing instanceof TFile)) return
      this.written.set(path, '')
      await this.app.fileManager.trashFile(existing)
      await this.dropCallout(path)
      return
    }
    const text = inkSvg(page)
    this.written.set(path, text)
    if (existing instanceof TFile) {
      if ((await vault.read(existing)) !== text) await vault.modify(existing, text)
    } else {
      await this.ensureFolder(inkFolderOf(this.book.path))
      await vault.create(path, text)
    }
    await this.addCallout(index, path)
  }

  /** The page's callout in the note new highlights go to, the note made if there is none. */
  private async addCallout(index: number, path: string): Promise<void> {
    const where = this.where()
    const note = (await noteFor(this.app, this.book, where)) ?? (await this.makeNote(where))
    const link = linkToPlace(
      this.app,
      this.book,
      { page: index + 1 },
      `Page ${index + 1}`,
      note.path
    )
    const block = inkCallout(link, path)
    const md = await this.app.vault.read(note)
    if (upsertInkCallout(md, path, block) === md) return
    await this.app.vault.process(note, (text) => upsertInkCallout(text, path, block))
  }

  /** The page's callout taken out of whichever of the book's notes has it. */
  private async dropCallout(path: string): Promise<void> {
    for (const note of notesOf(this.app, this.book, this.where())) {
      const md = await this.app.vault.read(note)
      if (removeInkCallout(md, path) === md) continue
      await this.app.vault.process(note, (text) => removeInkCallout(text, path))
    }
  }

  /** The book's highlights note, made for its first page of ink when it has none yet. */
  private async makeNote(where: NotesPlace): Promise<TFile> {
    const own = where.target.to === 'book'
    const path = own ? companionPath(this.book) : normalizePath(where.target.path)
    await this.ensureFolder(path.split('/').slice(0, -1).join('/'))
    // A wikilink whatever the link format: a property keeps its link tracked only as one.
    const bookLink = `[[${this.app.metadataCache.fileToLinktext(this.book, path, false)}]]`
    return this.app.vault.create(path, own ? newHighlightsNote(bookLink, this.book.basename) : '')
  }

  private async ensureFolder(dir: string): Promise<void> {
    const parts = dir.split('/').filter(Boolean)
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join('/')
      if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path)
    }
  }
}

/**
 * A PDF renamed or moved: its ink folder goes with it, and each page's file takes the book's new
 * name, through Obsidian, so the links to them in the notes follow.
 */
export async function moveInk(app: App, oldPath: string, newPath: string): Promise<void> {
  const fromDir = inkFolderOf(oldPath)
  const toDir = inkFolderOf(newPath)
  const from = app.vault.getAbstractFileByPath(fromDir)
  if (!(from instanceof TFolder)) return
  if (fromDir !== toDir) {
    if (app.vault.getAbstractFileByPath(toDir)) return
    await app.fileManager.renameFile(from, toDir)
  }
  const folder = app.vault.getAbstractFileByPath(toDir)
  if (!(folder instanceof TFolder)) return
  for (const file of [...folder.children]) {
    if (!(file instanceof TFile)) continue
    const index = inkPageOf(`${fromDir}/${file.name}`, oldPath)
    if (index === null) continue
    const to = inkPathOf(newPath, index)
    if (file.path !== to && !app.vault.getAbstractFileByPath(to))
      await app.fileManager.renameFile(file, to)
  }
}
