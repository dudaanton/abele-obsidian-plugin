import { sha256 as incremental } from '@noble/hashes/sha2'

/** Incremental hashing never asks WebCrypto to snapshot an attachment-sized input. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = incremental.create()
  for (let at = 0; at < bytes.length; at += 1024 * 1024) {
    hash.update(bytes.subarray(at, at + 1024 * 1024))
  }
  return Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
