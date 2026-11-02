import type { TFile, Vault } from 'obsidian'
import { chatForAgent, isChatLog } from '../chatText'
import { conversationLog } from '../ChatLog'

interface Entry {
  file: TFile
  mtime: number
  size: number
  text: string
}

// Never retain raw logs or private records. The cache grants no access: callers must first
// resolve their own scope and ceiling. File identity also invalidates deletion/recreation.
const caches = new WeakMap<Vault, Map<string, Entry>>()
const MAX_ENTRIES = 128
const MAX_CHARS = 2 * 1024 * 1024

export async function findChatText(
  vault: Vault,
  file: TFile,
  yieldControl: () => Promise<void>,
  read: () => Promise<string>
): Promise<string> {
  let cache = caches.get(vault)
  if (!cache) {
    cache = new Map()
    caches.set(vault, cache)
    // Invalidate even when a sync/write preserves the modification time and size.
    const invalidate = () => cache?.clear()
    vault.on('modify', invalidate)
    vault.on('delete', invalidate)
    vault.on('rename', invalidate)
  }
  const hit = cache.get(file.path)
  if (hit?.file === file && hit.mtime === file.stat.mtime && hit.size === file.stat.size) {
    cache.delete(file.path)
    cache.set(file.path, hit)
    return hit.text
  }
  cache.delete(file.path)
  const mtime = file.stat.mtime
  const size = file.stat.size
  const raw = await read()
  // A large log is reduced cooperatively before the synchronous codec sees it. Detection
  // uses the reduced log too, so renamed JSONL chats never take the full metadata scan.
  const log = await conversationLog(raw, yieldControl)
  const chat = isChatLog(file.path, log)
  const text = chat ? chatForAgent(log, file.path) : raw
  if (chat && file.stat.mtime === mtime && file.stat.size === size && text.length <= MAX_CHARS) {
    cache.set(file.path, { file, mtime, size, text })
    let chars = 0
    for (const entry of cache.values()) chars += entry.text.length
    while (cache.size > MAX_ENTRIES || chars > MAX_CHARS) {
      const oldest = cache.keys().next().value
      if (oldest === undefined) break
      chars -= cache.get(oldest).text.length
      cache.delete(oldest)
    }
  }
  return text
}
