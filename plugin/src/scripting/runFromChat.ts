import { Notice, type App } from 'obsidian'
import type { ChatSession } from '@/ai/ChatSession'
import { captureSelectionSource, SelectionCaptureConflict } from '@/ai/openChat'
import { anchorBacklink } from '@/selection/anchorLinks'
import { ScriptService } from './ScriptService'
import { ScriptWaitingError } from './ScriptTrust'
import type { SelectionLaunchTarget } from './runFromSelection'
import { SelectionScriptPicker } from './SelectionScriptPicker'

/** All source/revision evidence belongs to this session, captured before a menu or form opens.
 * Legacy identities are initialized lazily, after admission and form completion. */
export function captureChatScriptTarget(
  session: ChatSession,
  id: string,
  quote: string,
  start: number,
  renderedText: string
): SelectionLaunchTarget | undefined {
  const message = session.allMessages.value.find((m) => m.id === id)
  const file = session.currentChatFile.value
  if (
    !file ||
    !message ||
    message.draft ||
    (message.role !== 'user' && message.role !== 'assistant') ||
    session.kind === 'run'
  )
    return undefined
  const source = captureSelectionSource(session, id, quote, start, renderedText)
  return Object.freeze({
    kind: 'captured-chat' as const,
    text: quote,
    async prepare(signal: AbortSignal) {
      try {
        const snapshot = await source(signal)
        signal.throwIfAborted()
        const anchor = await session.ensureChatAnchor(snapshot)
        signal.throwIfAborted()
        return {
          status: 'ready' as const,
          snapshot,
          anchorId: anchor.id,
          backlink: anchorBacklink(file.path, {
            chatId: anchor.original.chatId,
            anchorId: anchor.id,
          }),
        }
      } catch (error) {
        if (error instanceof SelectionCaptureConflict)
          return { status: 'conflict' as const, reason: error.message }
        throw error
      }
    },
  })
}

/** Capture first; this closure never asks the active tab or the DOM for its source again. */
export function chatScriptAction(app: App, target: SelectionLaunchTarget): (name?: string) => void {
  const run = async (path: string, name: string) => {
    try {
      const outcome = await ScriptService.getInstance().executeFromSelection(path, target)
      if (outcome.status === 'conflict') new Notice(outcome.reason, 10000)
      else if (outcome.status === 'done') {
        const output = outcome.output.trim()
        new Notice(
          output ? (output.length > 500 ? `${output.slice(0, 500)}…` : output) : `${name}: done`,
          10000
        )
      }
    } catch (error) {
      if (error instanceof ScriptWaitingError) return
      new Notice(`${name}: ${error instanceof Error ? error.message : String(error)}`, 10000)
      console.error('[Abele] chat selection script failed', error)
    }
  }
  return (name?: string) => {
    const scripts = ScriptService.getInstance().getAll()
    if (!scripts.length) {
      new Notice('There are no scripts yet: add one to the scripts folder')
      return
    }
    if (!name)
      new SelectionScriptPicker(app, scripts, (s) => void run(s.path, s.meta.name), 'chat').open()
    else {
      const script = scripts.find((s) => s.meta.name === name)
      if (!script) new Notice(`Script "${name}" not found`)
      else void run(script.path, script.meta.name)
    }
  }
}
