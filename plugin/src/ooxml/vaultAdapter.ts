import type { App, TFile } from 'obsidian'
import { commitWordWrite } from './write'
import { openOfficeArchive } from './package'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
const writes = new Map<string, Promise<unknown>>()
/** Reviewed, best-effort optimistic publication. Preparation and rewind precede the final read. */
export async function writeOfficeChange(
  app: App, file: TFile, original: Uint8Array, updated: Uint8Array, signal?: AbortSignal,
  validate?: () => void, validateBytes: (bytes: Uint8Array) => Promise<unknown> = openOfficeArchive
): Promise<void> {
  signal?.throwIfAborted()
  await validateBytes(updated)
  signal?.throwIfAborted()
  const payload = updated.buffer.slice(updated.byteOffset,updated.byteOffset+updated.byteLength) as ArrayBuffer
  const path = file.path
  const previous = writes.get(path) ?? Promise.resolve()
  const saving = previous.catch(()=>{}).then(()=>{
    let didWrite = false
    const record = ChangeTracker.get(app)?.prepareBinaryWrite(path,original,()=>didWrite)
    const commit = () => commitWordWrite({
      read: async () => new Uint8Array(await app.vault.readBinary(file)),
      write: async () => {
        signal?.throwIfAborted()
        validate?.()
        didWrite = true
        await app.vault.modifyBinary(file,payload)
      },
    },original,updated,signal)
    return record ? record(commit) : commit()
  })
  writes.set(path,saving)
  try { await saving } finally { if(writes.get(path)===saving)writes.delete(path) }
}
