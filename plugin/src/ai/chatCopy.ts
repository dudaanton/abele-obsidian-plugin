/**
 * A chat file rewritten whole so that a crash at any moment leaves one whole copy of it.
 *
 * Obsidian writes a file by emptying it and then writing it a piece at a time, each piece
 * waiting its turn on the main thread. A long chat is several pieces, and an app that hangs
 * between two of them and is killed leaves the file empty or cut short — measured: a 6MB write
 * killed while the thread was busy left 0 bytes, or exactly 5MB. So the new content goes to a
 * copy in the plugin's folder first, the file second, and the copy is dropped only once the
 * file is whole. Reading the chat puts the copy back when it finds the file torn. Checked
 * owner changes instead keep the prior committed conversation until their write succeeds.
 *
 * The copy is this device's alone: it covers a write this device was making, nothing more.
 */
import type { App, TFile } from 'obsidian'
import { parseChat, serializeChat, type ParsedChat } from './ChatLog'

/** Where a chat's copy sits while it is rewritten: named for its path, out of the vault's sight. */
export function chatCopyPath(app: App, chatPath: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < chatPath.length; i++) {
    hash = Math.imul(hash ^ chatPath.charCodeAt(i), 0x01000193)
  }
  const name = (hash >>> 0).toString(16).padStart(8, '0')
  return `${app.vault.configDir}/plugins/abele/chat-backups/${name}.abchat`
}

/**
 * Replaces the file's content, by way of a copy. The copy's first line names the chat.
 * An optional check runs inside vault.process, retaining its external-change guard. Checked
 * writes require a copy of the previously committed chat and roll back a returned I/O failure;
 * a crash leaves that same committed conversation for readChat to recover on reopen.
 */
export async function rewriteChat(
  app: App,
  file: TFile,
  content: string,
  check?: (previous: string) => void
): Promise<void> {
  const adapter = app.vault.adapter
  const copy = chatCopyPath(app, file.path)
  // A checked owner change is not committed until process succeeds. Its recovery copy must
  // not apply an unchecked or failed annotation, including a crash before its guard runs.
  const prior = check ? await app.vault.read(file) : undefined
  const parsedPrior = prior === undefined ? null : parseChat(prior)
  // A readable log may still have an earlier torn append. Copying those damaged bytes
  // would make readChat reject the only backup after this rewrite truncates the main file.
  // Retain the recognised prior state as a whole v2 snapshot, never the proposed annotation.
  const copyContent =
    parsedPrior?.metadata &&
    (parsedPrior.version === 1 || parsedPrior.torn || parsedPrior.damaged > 0)
      ? serializeChat({ ...parsedPrior, metadata: parsedPrior.metadata })
      : (prior ?? content)
  let copied = false
  try {
    const folder = copy.slice(0, copy.lastIndexOf('/'))
    if (!(await adapter.exists(folder))) await adapter.mkdir(folder)
    await adapter.write(copy, `${file.path}\n${copyContent}`)
    copied = true
  } catch (err) {
    // An explicit owner change must not risk the conversation if its copy cannot be kept.
    if (check) throw err
    // The ordinary writer retains its existing best-effort behavior.
    console.warn('[Abele] Could not keep a copy of a chat being rewritten', err)
  }
  let previous: string | undefined
  try {
    if (check)
      await app.vault.process(file, (current) => {
        check(current)
        previous = current
        return content
      })
    else await app.vault.modify(file, content)
  } catch (err) {
    if (previous !== undefined) {
      // The write may have emptied or truncated the chat. Restore the committed conversation
      // while its already-durable copy stays untouched, even if restoration also fails.
      // Encode a legacy snapshot as v2, matching its recoverable rollback copy.
      const parsed = parseChat(previous)
      const restore = parsed.metadata
        ? serializeChat({ ...parsed, metadata: parsed.metadata })
        : previous
      try {
        await app.vault.modify(file, restore)
        try {
          await adapter.remove(copy)
        } catch {
          // A whole file wins over its leftover copy on the next read.
        }
      } catch (recoveryError) {
        console.error('[Abele] Could not restore a failed checked chat rewrite', recoveryError)
        // The restoration copy remains for readChat; the session must reconcile its writer.
      }
    } else if (check && copied) {
      // A rejected guard (or a failure before process ran) did not touch the chat.
      try {
        await adapter.remove(copy)
      } catch {
        // The unchanged whole chat remains authoritative on the next read.
      }
    }
    throw err
  }
  if (!copied) return
  try {
    await adapter.remove(copy)
  } catch {
    // Left behind beside a whole file, the copy is dropped by the next read, which finds
    // nothing torn to restore.
  }
}

/**
 * A transform of a chat without an owning session. Read through recovery, then compare exact
 * bytes inside the protected rewrite so an external edit cannot be lost during computation.
 * The extra check keeps ownership races (a tab opening during I/O) out of the same write.
 */
export async function transformChat(
  app: App,
  file: TFile,
  change: (content: string) => string,
  check?: () => void
): Promise<void> {
  check?.()
  await readChat(app, file)
  const previous = await app.vault.read(file)
  const content = change(previous)
  if (content === previous) return
  await rewriteChat(app, file, content, (current) => {
    check?.()
    if (current !== previous)
      throw new Error('This chat changed elsewhere. Reopen it before making changes.')
  })
}

/**
 * The chat, from its file or from the copy a rewrite left behind — whichever holds it whole.
 *
 * A copy exists only while a rewrite is under way, so finding one means the app stopped in the
 * middle. Which half it stopped in decides: a copy that is whole, beside a file that is torn or
 * empty, is the rewrite that did not finish; anything else is a copy cut short — the file was
 * not touched yet — or one that outlived a rewrite that did finish.
 */
export async function readChat(app: App, file: TFile): Promise<ParsedChat> {
  let result: ParsedChat | undefined
  const text = await readChatText(app, file, (text, content) => {
    const parsed = parseChat(text)
    const copy = parseChat(content)
    // Emptied and killed before the first piece landed reads as no chat at all: torn too.
    const fileTorn =
      parsed.torn ||
      parsed.damaged > 0 ||
      !text.trim() ||
      (parsed.version === 1 && !parsed.metadata)
    const copyWhole = copy.version === 2 && !copy.torn && copy.damaged === 0
    const recover = copyWhole && fileTorn && copy.records >= parsed.records
    result = recover ? copy : parsed
    return recover
  })
  return result ?? parseChat(text)
}

/**
 * Raw transcript recovery shared by chat logs and delegated-run JSON. The caller supplies
 * its format's whole-file test; a copy is never taken over another path or a valid newer file.
 */
export async function readChatText(
  app: App,
  file: TFile,
  recover: (current: string, backup: string) => boolean
): Promise<string> {
  const text = await app.vault.read(file)
  const adapter = app.vault.adapter
  const copyPath = chatCopyPath(app, file.path)
  if (!(await adapter.exists(copyPath))) return text
  const raw = await adapter.read(copyPath)
  const cut = raw.indexOf('\n')
  const content = raw.slice(cut + 1)
  if (cut === -1 || raw.slice(0, cut) !== file.path || !recover(text, content)) {
    await adapter.remove(copyPath)
    return text
  }
  console.warn(`[Abele] ${file.path}: a rewrite was cut short, restored from its copy`)
  await app.vault.modify(file, content)
  await adapter.remove(copyPath)
  return content
}
