/**
 * The file operations rewind needs, over Obsidian's vault where a file is in its index and its
 * adapter where it is not — a file kept in a dot-folder is on disk but never indexed.
 *
 * Writes go through the vault so that open editors, the metadata cache and every listener hear
 * of them the way they hear of any other change; removals go through the file manager, so they
 * land wherever the person's "Deleted files" setting sends them.
 */
import { TFile, TFolder, type App, type DataAdapter } from 'obsidian'
import { contentHash } from '../readGuard'
import type { Before, Current } from './types'

/** Extensions read and kept as text. Anything else is bytes. */
const TEXT_EXTENSIONS = new Set([
  'md',
  'txt',
  'canvas',
  'json',
  'js',
  'mjs',
  'ts',
  'css',
  'csv',
  'tsv',
  'base',
  'yaml',
  'yml',
  'html',
  'htm',
  'xml',
  'svg',
  'ics',
  'abchat',
  'excalidraw',
])

export function isTextPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 && TEXT_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

/** FNV-1a over the bytes, twice with different seeds: a fingerprint, not a checksum. */
export function bytesHash(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data)
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 0x01000193)
    h2 = Math.imul(h2 ^ bytes[i], 0x5bd1e995)
  }
  return `b${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}:${bytes.length}`
}

type Adapter = DataAdapter & {
  readBinary?(path: string): Promise<ArrayBuffer>
  writeBinary?(path: string, data: ArrayBuffer): Promise<void>
  stat?(path: string): Promise<{ type: 'file' | 'folder'; size: number } | null>
  list?(path: string): Promise<{ files: string[]; folders: string[] }>
}

export class VaultFs {
  constructor(private readonly app: App) {}

  private get adapter(): Adapter {
    return this.app.vault.adapter as Adapter
  }

  async kind(path: string): Promise<'file' | 'folder' | null> {
    const known = this.app.vault.getAbstractFileByPath(path)
    if (known instanceof TFolder) return 'folder'
    if (known) return 'file'
    if (!(await this.adapter.exists(path))) return null
    const stat = await this.adapter.stat?.(path)
    return stat?.type === 'folder' ? 'folder' : 'file'
  }

  async readText(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (file instanceof TFile) return this.app.vault.read(file)
    return this.adapter.read(path)
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.app.vault.getAbstractFileByPath(path)
    const vault = this.app.vault as App['vault'] & {
      readBinary?(file: TFile): Promise<ArrayBuffer>
    }
    if (file instanceof TFile && vault.readBinary) return vault.readBinary(file)
    if (this.adapter.readBinary) return this.adapter.readBinary(path)
    return new TextEncoder().encode(await this.adapter.read(path)).buffer
  }

  /** The state of a path now, with the text of a text file. */
  async current(path: string): Promise<Current> {
    const kind = await this.kind(path)
    if (kind === null) return { t: 'missing' }
    if (kind === 'folder') return { t: 'folder' }
    if (isTextPath(path)) {
      const text = await this.readText(path)
      return { t: 'text', hash: contentHash(text), text }
    }
    return { t: 'binary', hash: bytesHash(await this.readBinary(path)) }
  }

  /** Every file under a folder, deepest last — what a folder sent to the trash takes with it. */
  async filesUnder(path: string): Promise<string[]> {
    const folder = this.app.vault.getAbstractFileByPath(path)
    const out: string[] = []
    if (folder instanceof TFolder) {
      const walk = (f: TFolder) => {
        for (const child of f.children) {
          if (child instanceof TFolder) walk(child)
          else out.push(child.path)
        }
      }
      walk(folder)
      return out
    }
    const list = this.adapter.list
    if (!list) return out
    const walk = async (dir: string) => {
      const { files, folders } = await list.call(this.adapter, dir)
      out.push(...files)
      for (const sub of folders) await walk(sub)
    }
    await walk(path)
    return out
  }

  private async ensureParent(path: string): Promise<void> {
    const cut = path.lastIndexOf('/')
    if (cut <= 0) return
    await this.ensureFolder(path.slice(0, cut))
  }

  async ensureFolder(path: string): Promise<void> {
    if (!path || (await this.kind(path)) === 'folder') return
    await this.ensureParent(path)
    await this.app.vault.createFolder(path)
  }

  /** Makes the path hold this content, creating it (and its folders) when it is not there. */
  async put(path: string, before: Before, blob?: ArrayBuffer): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path)
    const vault = this.app.vault as App['vault'] & {
      modifyBinary?(file: TFile, data: ArrayBuffer): Promise<void>
    }
    if (before.t === 'text') {
      if (file instanceof TFile) return this.app.vault.modify(file, before.text)
      if (!(await this.adapter.exists(path)) && !path.startsWith('.')) {
        await this.ensureParent(path)
        await this.app.vault.create(path, before.text)
        return
      }
      return this.adapter.write(path, before.text)
    }
    if (before.t === 'binary' && blob) {
      if (file instanceof TFile && vault.modifyBinary) return vault.modifyBinary(file, blob)
      if (!file && !path.startsWith('.')) {
        await this.ensureParent(path)
        await this.app.vault.createBinary(path, blob)
        return
      }
      if (this.adapter.writeBinary) return this.adapter.writeBinary(path, blob)
    }
    throw new Error(`Nothing kept to put back at ${path}`)
  }

  /** Sends a file or folder to the trash the way the person's settings say. */
  async remove(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (file) return this.app.fileManager.trashFile(file)
    if (await this.adapter.exists(path)) await this.adapter.remove(path)
  }

  /** Removes a folder only when nothing is left in it. Returns whether it went. */
  async removeIfEmpty(path: string): Promise<boolean> {
    const folder = this.app.vault.getAbstractFileByPath(path)
    if (folder instanceof TFolder) {
      if (folder.children.length) return false
      await this.app.fileManager.trashFile(folder)
      return true
    }
    const listed = await this.adapter.list?.(path)
    if (!listed || listed.files.length || listed.folders.length) return false
    await this.adapter.rmdir(path, false)
    return true
  }

  async move(from: string, to: string): Promise<void> {
    await this.ensureParent(to)
    const file = this.app.vault.getAbstractFileByPath(from)
    if (file) return this.app.vault.rename(file, to)
    return this.adapter.rename(from, to)
  }
}
