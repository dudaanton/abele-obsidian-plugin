/**
 * What the top of a side discussion shows: the words it is about, where they live, and what the
 * agent is given besides them. Plain data, so the view stays small and tests can check each case.
 *
 * The real resolver reads the same sources `buildCommentContext` and
 * `buildMessageCommentContext` send to the model, so the list never claims more or less than
 * the model gets. A screen or a test hands its own through `setDiscussionAnchorResolver`.
 */
import type { ChatSession } from './ChatSession'
import { t } from '@/i18n'
import { describeCommentContext } from './commentContext'
import { describeMessageCommentContext } from './messageComments'
import { parseChat } from './ChatLog'
import { getNoteBody } from '@/helpers/notesUtils'
import { stripMarkers } from '@/editor/commentMarkers'

export interface AnchorSource {
  /** Lucide name: file-text for a note, message-square for a chat answer, book-open for a book. */
  icon: string
  /** Where the words are, in a few words: «Balcony garden», «Weather station · answer at 12:40». */
  text: string
  /** Set when the way back no longer finds the words as they were. */
  missing?: 'changed' | 'deleted'
  /** Goes back to the passage, marking it. Absent when there is nothing to go back to. */
  open?: () => void
}

export interface ContextItem {
  key: string
  icon: string
  title: string
  /** Quiet facts after the title: a size, a count, «words only». */
  detail?: string
  /** Opens what the item is: the note, the chat at that message, the agent's settings. */
  open?: () => void
}

export interface DiscussionAnchorView {
  quote: string
  /** The words were selected in a code block: they keep the code's font and lines. */
  code?: boolean
  source: AnchorSource
  context: ContextItem[]
}

type Resolver = (session: ChatSession) => Promise<DiscussionAnchorView | null>

/** Source data is read afresh, just as it is for each model turn. */
export interface DiscussionAnchorSources {
  read(path: string): Promise<string | null>
  lineage(anchor: import('./types').CommentAnchor): Promise<string[]>
  rendered(markdown: string): Promise<string>
  reveal(session: ChatSession): void
  agent(id: string): void
  book?(anchor: import('./types').CommentAnchor): Promise<{ deleted: boolean; around: boolean }>
}

export async function resolveDiscussionAnchor(
  session: ChatSession,
  sources: DiscussionAnchorSources
): Promise<DiscussionAnchorView | null> {
  const anchor = session.anchor.value
  if (!anchor?.quote) return null
  const content = anchor.cfi ? '' : await sources.read(anchor.note)
  const back = content === null ? undefined : () => sources.reveal(session)
  const context: ContextItem[] = [
    { key: 'selection', icon: 'text-select', title: t('discussion.selection') },
  ]
  const source: AnchorSource = {
    icon: anchor.cfi ? 'book-open' : anchor.message ? 'message-square' : 'file-text',
    text:
      anchor.note
        .split('/')
        .pop()
        ?.replace(/\.(md|abchat)$/, '') ?? anchor.note,
    open: back,
  }
  if (content === null) source.missing = 'deleted'
  if (anchor.cfi) {
    const facts = await sources.book?.(anchor)
    if (facts?.deleted) {
      source.missing = 'deleted'
      source.open = undefined
    }
    if (facts?.around)
      context.push({
        key: 'paragraph',
        icon: 'book-open',
        title: t('discussion.paragraph'),
        open: back,
      })
  } else if (anchor.message) {
    const lineage = await sources.lineage(anchor)
    const facts = describeMessageCommentContext(anchor, content, lineage)
    const parsed = content === null ? null : parseChat(content)
    const target = parsed?.messages.find((message) => message.id === anchor.message)
    if (facts.deleted) {
      source.missing = 'deleted'
      source.open = undefined
    } else if (!target || !(await sources.rendered(target.content)).includes(anchor.quote)) {
      source.missing = 'changed'
    }
    if (facts.title) source.text = facts.title
    if (facts.answer && target) {
      const who = target.role === 'user' ? t('discussion.person') : t('discussion.answer')
      const when = new Date(target.timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
      source.text += ` · ${who} ${when}`
      context.push({
        key: 'answer',
        icon: 'message-square',
        title: who,
        detail: facts.answerTruncated ? t('discussion.limited') : when,
        open: back,
      })
    }
    if (facts.before)
      context.push({
        key: 'conversation',
        icon: 'messages-square',
        title: t('discussion.conversation'),
        detail:
          t('discussion.messages', { count: facts.before }) +
          (facts.conversationTruncated ? ` · ${t('discussion.limited')}` : ''),
        open: back,
      })
    if (facts.lineage)
      context.push({
        key: 'lineage',
        icon: 'git-branch',
        title: t('discussion.lineage'),
        detail: t('discussion.passages', { count: facts.lineage }),
      })
    if (facts.deleted || !target)
      context.push({
        key: 'missing',
        icon: 'message-square',
        title: t('discussion.conversation'),
        detail: t(facts.deleted ? 'discussion.notSent' : 'discussion.answerMissing'),
      })
  } else {
    const body = getNoteBody(content ?? '')
    const facts = describeCommentContext(anchor, body, session.commentId ?? undefined)
    if (content !== null && !stripMarkers(body).includes(anchor.quote)) source.missing = 'changed'
    if (facts.paragraph)
      context.push({
        key: 'paragraph',
        icon: 'pilcrow',
        title: t('discussion.paragraph'),
        open: back,
      })
    context.push({
      key: 'note',
      icon: 'file-text',
      title: t('discussion.wholeNote'),
      detail:
        content === null
          ? t('discussion.notSent')
          : facts.wholeNote
            ? t('discussion.characters', { count: facts.characters })
            : t('discussion.tooLong'),
      open: back,
    })
  }
  const agent = session.agent.value
  if (agent)
    context.push({
      key: 'agent',
      icon: 'bot',
      title: agent.name,
      detail: t('discussion.instructionsTools'),
      open: () => sources.agent(agent.id),
    })
  if (
    !anchor.message &&
    !anchor.cfi &&
    (session.toolModes.value.edit_selection ?? 'ask') !== 'off'
  ) {
    context.push({
      key: 'edit',
      icon: 'pencil',
      title: t('discussion.editSelection'),
      detail: t(
        session.needsApproval('edit_selection') ? 'discussion.askFirst' : 'discussion.withoutAsking'
      ),
    })
  }
  return { quote: anchor.quote, code: anchor.code, source, context }
}

let resolver: Resolver = async (session) => {
  const [{ GlobalStore }, { CommentService }, { revealAnchor }, { replyMarkdownText }] =
    await Promise.all([
      import('@/stores/GlobalStore'),
      import('./CommentService'),
      import('./openChat'),
      import('./replyMarkdown'),
    ])
  const { app } = GlobalStore.getInstance()
  return resolveDiscussionAnchor(session, {
    read: async (path) => {
      const file = app.vault.getFileByPath(path)
      return file ? app.vault.cachedRead(file) : null
    },
    lineage: (anchor) => CommentService.getInstance().lineage(anchor),
    rendered: replyMarkdownText,
    book: async (anchor) =>
      (await import('@/reader/bookDiscussions')).describeBookDiscussionContext(anchor),
    reveal: (current) => {
      if (current.anchor.value) void revealAnchor(current.commentId ?? '', current.anchor.value)
    },
    agent: (id) => {
      void openDiscussionAgent(id)
    },
  })
}

async function openDiscussionAgent(agentId: string): Promise<void> {
  const [{ default: AgentEditorModal }, { mountKit }] = await Promise.all([
    import('@/components/settings/ai/AgentEditorModal.vue'),
    import('@/components/obsidian/mount'),
  ])
  const host = document.body.createDiv()
  const mounted = mountKit(
    host,
    AgentEditorModal,
    { agentId, onClose: () => mounted.unmount() },
    { remove: true }
  )
}

export function setDiscussionAnchorResolver(next: Resolver): void {
  resolver = next
}

export function discussionAnchor(session: ChatSession): Promise<DiscussionAnchorView | null> {
  return resolver(session)
}
