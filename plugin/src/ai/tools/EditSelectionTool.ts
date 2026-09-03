import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { parseMarkers, resolveQuote } from '@/editor/commentMarkers'
import { EDIT_SELECTION_TOOL } from '../types'
import type { AgentTool } from '../client'
import type { ChatSession } from '../ChatSession'

/**
 * Rewrites the passage a comment is anchored to.
 *
 * Bound to one session rather than registered globally: the range it may touch comes from
 * that session's marker and stored quote, so there is no path argument to get wrong and no
 * way to reach the rest of the note. `ChatSession.getTools` hands it out only to a comment
 * that has a quote.
 */
export function createEditSelectionTool(session: ChatSession): AgentTool {
  return {
    name: EDIT_SELECTION_TOOL,
    label: 'Edit selection',
    description:
      'Rewrite the passage this comment is attached to. Provide the full replacement text; the rest of the note is left alone.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The replacement text for the commented passage' },
      },
      required: ['text'],
    },
    execute: async (_id, params) => {
      const { text } = params as { text: string }
      if (text == null) throw new Error('Missing required parameter: text')
      // Blanking the passage would set the stored quote to '', and a comment with no quote is
      // no longer offered this tool — so the agent could delete the text and not put it back.
      if (text.trim() === '') {
        throw new Error(
          'edit_selection needs replacement text. To remove the passage, ask the person to delete it.'
        )
      }

      const anchor = session.anchor.value
      const commentId = session.commentId
      if (!anchor || !commentId) {
        throw new Error('edit_selection is only available inside a comment chat')
      }

      const { app } = GlobalStore.getInstance()
      const file = app.vault.getAbstractFileByPath(anchor.note)
      if (!(file instanceof TFile)) throw new Error(`Note not found: ${anchor.note}`)

      // One read-modify-write under the vault's own lock: the person may be typing into this
      // note while the answer is being written.
      let replaced = false
      await app.vault.process(file, (content) => {
        const marker = parseMarkers(content).find((m) => m.ids.includes(commentId))
        if (!marker) return content

        const range = resolveQuote(content, marker, anchor.quote)
        if (!range) return content

        replaced = true
        return content.slice(0, range.from) + text + content.slice(range.to)
      })

      if (!replaced) {
        throw new Error(
          'The commented passage could not be found in the note any more; it was probably rewritten. Nothing was changed.'
        )
      }

      const old = anchor.quote ?? ''
      // The quote moves with the text, or the card would come unstuck from its own edit.
      session.anchor.value = { ...anchor, quote: text }
      await session.save()

      return {
        content: [{ type: 'text', text: `Rewrote the commented passage in ${anchor.note}` }],
        details: { diff: { old, new: text }, path: anchor.note },
      }
    },
  }
}
