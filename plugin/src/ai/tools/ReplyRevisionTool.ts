import type { AgentTool } from '../client'
import type { ChatSession } from '../ChatSession'
import { CommentService } from '../CommentService'
import type { ReplyProposal } from '../replyAnnotations'
import { resolveReplyPassage } from '../replyPassage'
import { replyMarkdownText } from '../replyMarkdown'

export const REPLY_REVISION_TOOL = 'propose_reply_revision'

/** A session-scoped proposal tool: it has no write access to the parent conversation. */
export function createReplyRevisionTool(session: ChatSession): AgentTool {
  return {
    name: REPLY_REVISION_TOOL,
    label: 'Propose reply revision',
    description:
      'Only when the user explicitly asks you to rewrite or clarify the selected passage of the parent model reply: propose its replacement. Quote the latest user request exactly in request. Discussion alone is not a request to edit. This tool NEVER edits the parent: the owner must review the passage diff and accept it separately. Do not use file tools to edit chat files.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'Full replacement markdown for the selected passage only',
        },
        request: {
          type: 'string',
          description: 'The latest user message, verbatim, explicitly requesting this revision',
        },
      },
      required: ['text', 'request'],
    },
    execute: async (id, params) => {
      const anchor = session.anchor.value
      if (session.kind !== 'comment' || !anchor?.message || !anchor.quote)
        throw new Error(
          'This tool is only available in a comment on selected words of a model reply.'
        )
      const latest = session.messages.value.findLast((m) => m.role === 'user' && !m.draft)
      if (
        typeof params.request !== 'string' ||
        !params.request.trim() ||
        params.request !== latest?.content
      )
        throw new Error(
          'Cite the current explicit user request verbatim. Do not propose revisions during discussion alone.'
        )
      if (typeof params.text !== 'string' || !params.text.trim())
        throw new Error('Provide replacement text.')
      const message = await CommentService.getInstance().readReply(anchor.note, anchor.message)
      if (message.role !== 'assistant') throw new Error('Only model replies can be revised here.')
      const start = await CommentService.getInstance().replyCommentStart(
        anchor.note,
        session.commentId!
      )
      const passage = await resolveReplyPassage(
        message.content,
        anchor.quote,
        start,
        replyMarkdownText
      )
      const replyProposal: ReplyProposal = {
        id: `${session.commentId}:${id}`,
        parent: anchor.note,
        message: message.id,
        before: message.content,
        ...passage,
        text: params.text,
        request: params.request,
        author: session.agent.value?.name || 'Comment agent',
        at: Date.now(),
        status: 'pending',
      }
      return {
        content: [
          {
            type: 'text',
            text: 'Replacement proposed for owner review. The parent reply is unchanged until the owner accepts the passage diff.',
          },
        ],
        details: { replyProposal },
      }
    },
  }
}
