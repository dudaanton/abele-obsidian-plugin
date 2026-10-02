/**
 * Storage-independent best-effort optimistic check. The adapter serializes its own writes only.
 * This read/write API is NOT compare-and-swap: an external writer can race between them.
 */
export interface WordStorage {
  read(): Promise<Uint8Array>
  write(bytes: Uint8Array): Promise<void>
}
export const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i])
export async function commitWordWrite(
  storage: WordStorage,
  before: Uint8Array,
  after: Uint8Array,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  const now = await storage.read()
  if (!sameBytes(before, now))
    throw new Error('Document changed while editing. Read it again before saving.')
  signal?.throwIfAborted()
  if (!sameBytes(before, after)) {
    await storage.write(after)
    const saved = await storage.read().catch((): null => null)
    if (!saved || !sameBytes(saved, after))
      throw new Error('The file changed while saving; reopen to see the latest version.')
  }
}
/** Stable version token for agent calls, not a signature or authorization mechanism. */
export function wordRevision(bytes: Uint8Array): string {
  let a = 2166136261
  let b = 5381
  for (const byte of bytes) {
    a = Math.imul(a ^ byte, 16777619)
    b = Math.imul(b, 33) ^ byte
  }
  return `${bytes.length.toString(16)}-${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`
}
