import { sha256 as incremental } from '@noble/hashes/sha2'
import { SyncTaskBudget } from '../syncTaskBudget'

const budget = new SyncTaskBudget()

/** Incremental hashing never asks WebCrypto to snapshot an attachment-sized input. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = incremental.create()
  for (let at = 0; at < bytes.length; at += 64 * 1024) {
    const chunk = bytes.subarray(at, at + 64 * 1024)
    hash.update(chunk)
    await budget.account(chunk.length)
  }
  return Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
