import { Notice, TFile, type App } from 'obsidian'
import { isHeicImport, normalizeImageImport } from './imageImport'

/** Obsidian adapter: try native conversion, then store under a collision-free filename. */
export async function createImportedBinary(app: App, path: string, blob: Blob, signal?: AbortSignal): Promise<TFile> {
  signal?.throwIfAborted()
  const incoming = await normalizeImageImport(path, blob)
  signal?.throwIfAborted()
  if (incoming.unconvertedHeic) unsupportedHeicNotice()
  return storeIncoming(app, incoming, signal)
}

function unsupportedHeicNotice(): void {
  new Notice('HEIC is converted on iPhone/iPad only. Keeping the original file.')
}

async function storeIncoming(app: App, incoming: { name: string; blob: Blob }, signal?: AbortSignal): Promise<TFile> {
  let target = incoming.name
  let counter = 1
  while (app.vault.getAbstractFileByPath(target)) {
    const dot = incoming.name.lastIndexOf('.')
    const base = dot > incoming.name.lastIndexOf('/') ? incoming.name.slice(0, dot) : incoming.name
    const ext = dot > incoming.name.lastIndexOf('/') ? incoming.name.slice(dot) : ''
    target = `${base} ${counter++}${ext}`
  }
  const bytes = await incoming.blob.arrayBuffer()
  signal?.throwIfAborted()
  return app.vault.createBinary(target, bytes)
}

/** Keep vault originals; use a PNG copy when native conversion works, otherwise reuse the file. */
export async function imageFileForImport(app: App, file: TFile): Promise<TFile> {
  if (!isHeicImport(file.path)) return file
  const incoming = await normalizeImageImport(
    file.path,
    new Blob([await app.vault.readBinary(file)], { type: 'image/heic' })
  )
  if (incoming.unconvertedHeic) {
    unsupportedHeicNotice()
    return file
  }
  return storeIncoming(app, incoming)
}
