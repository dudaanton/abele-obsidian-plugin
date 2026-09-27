/**
 * The fonts folder: which families it holds, kept current as files come, go and are renamed —
 * by hand, or by Obsidian Sync from another device — and the bytes of the family a book is set in.
 *
 * Nothing is read until a book or the settings ask: a file is read once to learn what it is, and
 * read again only when it changes. The bytes of the family in use are kept; the rest are not.
 */
import { shallowRef, ref } from 'vue'
import type { EventRef, TAbstractFile } from 'obsidian'
import {
  faceFromFileName,
  faceFromFont,
  familiesOf,
  isFontPath,
  type FaceInfo,
  type FontFamily,
  type FontFile,
} from './fontNames'
import type { FaceData } from './fontFaces'

interface FontFileRef {
  path: string
  name: string
  stat: { mtime: number; size: number }
}

/** A file or folder as the vault hands it out: a folder has children, a file its size and time. */
interface Entry {
  path: string
  name: string
  stat?: { mtime: number; size: number }
  children?: Entry[]
}

/** The slice of Obsidian's vault the fonts folder is read through. */
export interface FontsVault {
  getAbstractFileByPath(path: string): Entry | null
  readBinary(file: FontFileRef): Promise<ArrayBuffer>
  on(name: 'create' | 'modify' | 'delete', cb: (file: TAbstractFile) => unknown): EventRef
  on(name: 'rename', cb: (file: TAbstractFile, oldPath: string) => unknown): EventRef
  offref(ref: EventRef): void
}

const stampOf = (f: FontFileRef) => `${f.stat.mtime}:${f.stat.size}`

/** How long after a change in the folder it is read again: a sync brings files in a burst. */
export const RESCAN_MS = 250

export class ReaderFonts {
  /** The families in the folder, by name. */
  readonly families = shallowRef<FontFamily[]>([])
  /** Moves on whenever a family comes, goes, or its files change. */
  readonly version = ref(0)
  private infos = new Map<string, { stamp: string; info: FaceInfo }>()
  private bytes = new Map<string, { stamp: string; data: ArrayBuffer }>()
  private scanned: Promise<void> | null = null
  private scannedFolder: string | null = null
  private key = ''
  private timer = 0
  private running: Promise<void> = Promise.resolve()

  constructor(
    private readonly vault: FontsVault,
    private readonly folder: () => string
  ) {}

  /** Follows the folder's files; the returned function stops it. */
  start(): () => void {
    const changed = (path: string) => {
      if (this.scannedFolder !== null && this.inFolder(path)) this.rescanSoon()
    }
    const refs = [
      this.vault.on('create', (f) => changed(f.path)),
      this.vault.on('modify', (f) => changed(f.path)),
      this.vault.on('delete', (f) => changed(f.path)),
      this.vault.on('rename', (f, old) => {
        changed(f.path)
        changed(old)
      }),
    ]
    return () => {
      window.clearTimeout(this.timer)
      for (const r of refs) this.vault.offref(r)
    }
  }

  /** The folder's families, read the first time they are asked for. */
  ensure(): Promise<void> {
    return (this.scanned ??= this.scan())
  }

  /** The folder set in the settings may have changed: read again if it has. */
  folderChanged(): void {
    if (this.scannedFolder !== null && this.folder() !== this.scannedFolder) this.rescanSoon(0)
  }

  /** Reads the folder again, one reading at a time. */
  scan(): Promise<void> {
    this.running = this.running
      .then(() => this.read())
      .catch((e: unknown) => {
        console.warn('[Abele] the fonts folder could not be read', e)
      })
    return (this.scanned = this.running)
  }

  /** The faces of a family, read, ready to put into a page; none when it is not in the folder. */
  async facesOf(name: string): Promise<FaceData[]> {
    await this.ensure()
    const family = this.families.value.find((f) => f.name.toLowerCase() === name.toLowerCase())
    const files = family?.files ?? []
    const wanted = new Set(files.map((f) => f.path))
    for (const path of this.bytes.keys()) if (!wanted.has(path)) this.bytes.delete(path)
    const out: FaceData[] = []
    for (const file of files) {
      const ref = this.fileAt(file.path)
      if (!ref) continue
      const stamp = stampOf(ref)
      let kept = this.bytes.get(file.path)
      if (kept?.stamp !== stamp) {
        try {
          kept = { stamp, data: await this.vault.readBinary(ref) }
        } catch (e) {
          console.warn(`[Abele] the font ${file.path} could not be read`, e)
          continue
        }
        this.bytes.set(file.path, kept)
      }
      out.push({ path: file.path, weight: file.weight, style: file.style, stamp, data: kept.data })
    }
    return out
  }

  private inFolder(path: string): boolean {
    const folder = this.folder()
    return !!folder && path.startsWith(`${folder}/`) && isFontPath(path)
  }

  private fileAt(path: string): FontFileRef | undefined {
    const entry = this.vault.getAbstractFileByPath(path)
    return entry?.stat && !entry.children ? (entry as FontFileRef) : undefined
  }

  /** The font files in the folder and the folders in it. */
  private filesIn(folder: string): FontFileRef[] {
    const out: FontFileRef[] = []
    const walk = (entry: Entry | null) => {
      if (!entry) return
      if (entry.children) for (const child of entry.children) walk(child)
      else if (entry.stat && this.inFolder(entry.path)) out.push(entry as FontFileRef)
    }
    walk(this.vault.getAbstractFileByPath(folder))
    return out
  }

  private rescanSoon(ms = RESCAN_MS): void {
    window.clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      void this.scan()
    }, ms)
  }

  private async read(): Promise<void> {
    const folder = this.folder()
    this.scannedFolder = folder
    const files = folder ? this.filesIn(folder) : []
    const seen = new Set<string>()
    const found: FontFile[] = []
    for (const file of files) {
      seen.add(file.path)
      const stamp = stampOf(file)
      let kept = this.infos.get(file.path)
      if (kept?.stamp !== stamp) {
        let info: FaceInfo | null = null
        try {
          const data = await this.vault.readBinary(file)
          info = await faceFromFont(data)
        } catch (e) {
          console.warn(`[Abele] the font ${file.path} could not be read`, e)
        }
        kept = { stamp, info: info ?? faceFromFileName(file.name) }
        this.infos.set(file.path, kept)
      }
      found.push({ path: file.path, ...kept.info })
    }
    for (const path of this.infos.keys()) if (!seen.has(path)) this.infos.delete(path)
    const families = familiesOf(found)
    const key = JSON.stringify(
      families.map((f) => [f.name, f.files.map((x) => [x.path, this.infos.get(x.path)?.stamp])])
    )
    if (key === this.key) return
    this.key = key
    this.families.value = families
    this.version.value++
  }
}

let current: ReaderFonts | null = null

/** The fonts folder, once the reader is registered. */
export const readerFonts = (): ReaderFonts | null => current

export function initReaderFonts(fonts: ReaderFonts | null): ReaderFonts | null {
  current = fonts
  return fonts
}
