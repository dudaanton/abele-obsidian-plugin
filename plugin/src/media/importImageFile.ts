import { TFile, type App } from 'obsidian'
import { isHeicImport, normalizeImageImport } from './imageImport'

/** Obsidian adapter: convert first, then allocate a collision-free name and store only PNG. */
export async function createImportedBinary(app: App, path: string, blob: Blob): Promise<TFile> {
  const incoming = await normalizeImageImport(path, blob)
  let target = incoming.name
  let counter = 1
  while (app.vault.getAbstractFileByPath(target)) {
    const dot = incoming.name.lastIndexOf('.')
    const base = dot > incoming.name.lastIndexOf('/') ? incoming.name.slice(0, dot) : incoming.name
    const ext = dot > incoming.name.lastIndexOf('/') ? incoming.name.slice(dot) : ''
    target = `${base} ${counter++}${ext}`
  }
  return app.vault.createBinary(target, await incoming.blob.arrayBuffer())
}

/** Existing originals belong to the vault; keep them, but attach/use the PNG copy only. */
export async function imageFileForImport(app: App, file: TFile): Promise<TFile> {
  if (!isHeicImport(file.path)) return file
  return createImportedBinary(app, file.path, new Blob([await app.vault.readBinary(file)], { type: 'image/heic' }))
}
