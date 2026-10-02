import type { App, TFile } from 'obsidian'
import { openDocx } from './package'
import { applyWordEdit, type WordEdit } from './edit'
import { imageResource, type WordResources } from './imageOps'
import { wordPreviewText } from './preview'
import { TFile as VaultFile } from 'obsidian'
import { wordRevision } from './write'
import { writeOfficeChange } from '@/ooxml/vaultAdapter'
export const loadWordBytes = (bytes: Uint8Array) => openDocx(bytes, () => new Promise<void>(resolve => window.setTimeout(resolve, 0)))
export const vaultWordResources = (app: App): WordResources => ({
  loadImage: async path => {
    const image = app.vault.getAbstractFileByPath(path)
    if (!(image instanceof VaultFile)) throw new Error('Vault image not found')
    return imageResource(new Uint8Array(await app.vault.readBinary(image)))
  },
})
export async function prepareWordChange(app: App, file: TFile, edit: WordEdit, revision?: string) {
  const original = new Uint8Array(await app.vault.readBinary(file))
  if (revision && wordRevision(original) !== revision) throw new Error('Document changed since it was read. Read it again.')
  const doc = await loadWordBytes(original)
  const updated = await applyWordEdit(doc, edit, vaultWordResources(app))
  const after = await loadWordBytes(updated)
  return {original,updated,diff:{old:wordPreviewText(doc,edit),new:wordPreviewText(after,edit)}}
}
export const writeWordChange = (app: App, file: TFile, original: Uint8Array, updated: Uint8Array, signal?: AbortSignal) =>
  writeOfficeChange(app,file,original,updated,signal,undefined,loadWordBytes)
