import { ChatService } from '@/ai/ChatService'
import { CommentService } from '@/ai/CommentService'
import { ChatSelectionBindings } from '@/ai/chatBindings'
import type { SelectionBindingPort, SelectionBindingResult } from '@/selection/bindings'
import type { SelectionScriptContext } from './selectionContext'
import type { BookScriptContext } from './bookContext'
import { scriptVocabulary } from './vocabularyApi'

/** Resolved by captured identity, never the active tab. No capability is persisted in run logs. */
export function selectionBinding(
  selection: SelectionScriptContext,
  opts: {
    book?: BookScriptContext
    signal: AbortSignal
    wrote(path: string): void
    track?: (work: Promise<unknown>) => void
  }
): SelectionBindingPort {
  return {
    bind(notePath: string) {
      opts.signal.throwIfAborted()
      const work = (async (): Promise<SelectionBindingResult> => {
        if (selection.source.kind === 'book') {
          if (!opts.book) throw new Error('The captured book context is unavailable.')
          const rule = await scriptVocabulary({
            book: opts.book,
            signal: opts.signal,
            wrote: opts.wrote,
          }).mark({ note: notePath, forms: [selection.text] })
          return {
            status: 'applied',
            targetPath: rule?.note ?? notePath,
            backlink: selection.backlink,
            operationId: '',
            recoverable: false,
          }
        }
        const chatId = selection.source.chatId
        const sessions = new Set([
          ...ChatService.getInstance().getAllSessions(),
          ...CommentService.getInstance().sessions.values(),
        ])
        const anchorId = 'anchorId' in selection ? selection.anchorId : ''
        const candidates = [...sessions].filter((session) =>
          session
            .bindingState()
            .messages.some((message) =>
              message.selection?.anchors.some(
                (anchor) => anchor.id === anchorId && anchor.original.chatId === chatId
              )
            )
        )
        if (candidates.length !== 1)
          return {
            status: 'known-not-written',
            targetPath: notePath,
            backlink: selection.backlink,
            operationId: '',
            recoverable: false,
            reason:
              'The captured conversation is closed or duplicated. Keep the card and reopen its source to bind the selection.',
          }
        return new ChatSelectionBindings(candidates[0]).bind(
          selection as Extract<SelectionScriptContext, { anchorId: string }>,
          anchorId,
          notePath,
          opts.signal
        )
      })()
      opts.track?.(work)
      return work
    },
  }
}
