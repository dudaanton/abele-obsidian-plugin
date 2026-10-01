import type { App, TFile } from 'obsidian'
import { openDocx } from './package'
import { applyWordEdit, type WordEdit } from './edit'
import { imageResource, type WordResources } from './imageOps'
import { wordPreviewText } from './preview'
import { TFile as VaultFile } from 'obsidian'
import { commitWordWrite, wordRevision } from './write'

export const loadWordBytes = (bytes: Uint8Array) =>
  openDocx(bytes, () => new Promise<void>((resolve) => window.setTimeout(resolve, 0)))
export const vaultWordResources = (app: App): WordResources => ({
  loadImage: async (path) => {
    const image = app.vault.getAbstractFileByPath(path)
    if (!(image instanceof VaultFile)) throw new Error('Vault image not found')
    return imageResource(new Uint8Array(await app.vault.readBinary(image)))
  },
})
const writes = new Map<string, Promise<unknown>>()
export async function prepareWordChange(app: App, file: TFile, edit: WordEdit, revision?: string) {
  const original = new Uint8Array(await app.vault.readBinary(file))
  if (revision && wordRevision(original) !== revision)
    throw new Error('Document changed since it was read. Read it again.')
  const doc = await loadWordBytes(original)
  const updated = await applyWordEdit(doc, edit, vaultWordResources(app))
  const after = await loadWordBytes(updated)
  return {
    original,
    updated,
    diff: {
      old: wordPreviewText(doc, edit),
      new: wordPreviewText(after, edit),
    },
  }
}
export async function writeWordChange(
  app: App,
  file: TFile,
  original: Uint8Array,
  updated: Uint8Array,
  signal?: AbortSignal
): Promise<void> {
  const previous = writes.get(file.path) ?? Promise.resolve()
  const saving = previous
    .catch(() => {})
    .then(() =>
      commitWordWrite(
        {
          read: async () => new Uint8Array(await app.vault.readBinary(file)),
          write: async (bytes) => {
            signal?.throwIfAborted()
            await app.vault.modifyBinary(
              file,
              bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength
              ) as ArrayBuffer
            )
          },
        },
        original,
        updated,
        signal
      )
    )
  writes.set(file.path, saving)
  try {
    await saving
  } finally {
    if (writes.get(file.path) === saving) writes.delete(file.path)
  }
}
