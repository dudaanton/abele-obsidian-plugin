import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatService } from './ChatService'
import type { ChatSession } from './ChatSession'
import { parseChat, parseChatMetadata } from './ChatLog'
import { firstQuestion, isChatLog } from './chatText'
import type { CommentAnchor } from './types'

/**
 * The chain a comment hangs from: a comment on a message of a chat, a comment on a message of
 * that comment, and so on — each one's `anchor.note` naming the file of the level above, until a
 * note or an ordinary chat ends it.
 */

/**
 * How far up a trail is walked. Far beyond anything a person asks by hand; what it is for is a
 * chain somebody edited into a loop, which would otherwise be walked for ever.
 */
const MAX_TRAIL_DEPTH = 32

/** A book or PDF the reader opens: the root of a discussion asked about words in it. */
const BOOK_FILE = /\.(epub|pdf|mobi|azw3?|fb2|fbz|cbz)$/i

/** A quote from a level above, kept short: it says where, the conversation says what. */
const QUOTE_IN_LINEAGE = 200

/**
 * One level of the way down from where a conversation started to the comment in front.
 *
 * The first step is what the chain hangs from — a note, or a chat — and every step after it is a
 * comment, hung by its `anchor` on a message (or a passage) of the step before it. That anchor
 * is what going back to a level is: the step above opened, and the place the next one hangs on
 * brought into view.
 */
export interface TrailStep {
  kind: 'note' | 'chat' | 'comment'
  /** The file: the note, the chat, or the comment's own file. */
  path: string
  /** What to call it: a note's name, a chat's title, the question that opened a comment. */
  title: string
  /** A comment's id. */
  id?: string
  /** Where a comment hangs in the step before it. */
  anchor?: CommentAnchor
  /** A level whose file has gone. It is still named, so the trail does not silently shorten. */
  missing?: boolean
}

/** What the walk asks of the comment service: which paths are comments, and the live sessions. */
export interface TrailSource {
  isCommentPath(path: string): boolean
  sessionFor(id: string): ChatSession | null
}

/**
 * What a comment is called on a trail: its own title once it has been opened as a chat — it has
 * one then, the one the history shows — and the question that opened it before that.
 */
export function commentName(session: ChatSession): string {
  return (
    (session.kind === 'chat' && session.chatTitle.value) || firstQuestion(session.messages.value)
  )
}

/**
 * The way down to this comment from where it all started: the note or chat at the root, every
 * comment in between, and this one last. Read from the sessions that are loaded and from the
 * files that are not, without loading anything — drawing a trail must not start sessions.
 */
export async function commentTrail(
  source: TrailSource,
  session: ChatSession
): Promise<TrailStep[]> {
  const anchor = session.anchor.value
  const own = session.currentChatFile.value?.path
  if (!anchor || !own) return []

  const current: TrailStep = {
    kind: 'comment',
    path: own,
    id: session.commentId ?? baseName(own),
    anchor,
    title: commentName(session) || anchor.quote || 'New question',
  }
  return [...(await stepsAbove(source, anchor.note, new Set([own]))), current]
}

/**
 * What a comment's agent is told about the levels above the conversation it is in: each one's
 * quoted words and where they were, nearest first. Names and quotes only — the conversations up
 * there are the person's to open, and carrying them would make every level cost more than the
 * one before it. Empty when the conversation it is in is not itself a comment.
 */
export async function commentLineage(
  source: TrailSource,
  anchor: CommentAnchor
): Promise<string[]> {
  const steps = await stepsAbove(source, anchor.note, new Set())
  const lines: string[] = []
  for (let at = steps.length - 1; at > 0; at--) {
    const step = steps[at]
    const quote = step.anchor?.quote
      ? `«${clip(step.anchor.quote, QUOTE_IN_LINEAGE)}»`
      : 'the whole'
    const where = step.anchor?.message ? ' of a message' : ''
    lines.push(`- on ${quote}${where} in ${describeStep(steps[at - 1])}`)
  }
  return lines
}

/** The levels a file hangs from, root first, the file itself last. */
async function stepsAbove(
  source: TrailSource,
  path: string,
  seen: Set<string>
): Promise<TrailStep[]> {
  const steps: TrailStep[] = []
  let at: string | undefined = path

  while (at && steps.length < MAX_TRAIL_DEPTH) {
    if (seen.has(at)) break
    seen.add(at)

    if (!source.isCommentPath(at)) {
      steps.unshift(await rootStep(at))
      break
    }

    const step = await commentStep(source, at)
    steps.unshift(step)
    at = step.anchor?.note
  }
  return steps
}

async function commentStep(source: TrailSource, path: string): Promise<TrailStep> {
  const id = baseName(path)
  const live = source.sessionFor(id)
  if (live && live.currentChatFile.value) {
    const anchor = live.anchor.value ?? undefined
    return { kind: 'comment', path, id, anchor, title: commentName(live) || anchor?.quote || id }
  }

  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) {
    return { kind: 'comment', path, id, title: 'Deleted', missing: true }
  }

  const parsed = parseChat(await app.vault.cachedRead(file))
  const anchor = parsed.metadata?.anchor
  const title =
    (parsed.metadata?.kind === 'chat' && parsed.metadata.title) ||
    firstQuestion(parsed.messages) ||
    anchor?.quote ||
    id
  return { kind: 'comment', path, id, anchor, title }
}

async function rootStep(path: string): Promise<TrailStep> {
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  const base = baseName(path)
  if (!isChatLog(path)) {
    return { kind: 'note', path, title: base, ...(file instanceof TFile ? {} : { missing: true }) }
  }

  const open = ChatService.getInstance().getSessionByFile(path)
  if (open) return { kind: 'chat', path, title: open.chatTitle.value || base }
  if (!(file instanceof TFile)) return { kind: 'chat', path, title: base, missing: true }
  const metadata = parseChatMetadata(await app.vault.cachedRead(file))
  return { kind: 'chat', path, title: metadata?.title || base }
}

/** A file's name without its folder or extension — a comment's id, a note's title. */
export function baseName(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

function clip(text: string, length: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length)}…` : flat
}

function describeStep(step: TrailStep): string {
  const gone = step.missing ? ', deleted since' : ''
  // A discussion started in a book hangs from the book, which is not a note.
  if (step.kind === 'note' && BOOK_FILE.test(step.path)) return `the book ${step.path}${gone}`
  if (step.kind === 'note') return `the note ${step.path}${gone}`
  if (step.kind === 'chat') return `the chat "${step.title}" (${step.path})${gone}`
  return `the side discussion "${step.title}" (${step.path})${gone}`
}
