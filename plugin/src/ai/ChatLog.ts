import type { ChatMessage, ChatMetadata } from './types'
import type { Message } from './client'
/** Kept self-contained with the log codec: only positive records retire an identity. */
function settledAttention(state: NonNullable<ChatMetadata['attention']> = {}): Set<string> {
  return new Set([
    ...(state.resolved ?? []),
    ...(state.errors ?? []).filter((e) => e.seen).map((e) => e.id),
    ...(state.run?.status === 'done' ? [state.run.id] : []),
    ...(state.question && ['answered', 'cancelled'].includes(state.question.status)
      ? [state.question.id]
      : []),
    ...Object.entries(state.tools ?? {})
      .filter(([, status]) => status === 'done')
      .map(([id]) => id),
  ])
}

/**
 * The `.abchat` file format.
 *
 * Version 2 is a log: one JSON record per line, appended as the conversation goes. Version 1
 * was a single JSON object rewritten in full on every change, which cost time proportional to
 * the whole conversation — measured at 27ms per save on an 8MB chat, against 2ms flat for an
 * append, and a long agentic conversation saves once per tool call.
 *
 * The data suits a log: internal messages, three quarters of a chat file, are only ever added.
 * Chat messages are added and occasionally rewritten in place — a tool result arriving, a
 * delegated run being attached — so a later record for the same id replaces an earlier one.
 * Nothing is ever removed, which is why there is no tombstone record; adding deletion to the
 * session means adding one here too.
 */
export const CHAT_FORMAT_VERSION = 2

/** Rewrite the file once it holds this many times more records than live entities. */
const COMPACTION_RATIO = 2

export interface ChatSnapshot {
  metadata: ChatMetadata
  messages: ChatMessage[]
  internalMessages: Message[]
}

export interface ParsedChat {
  metadata: ChatMetadata | null
  messages: ChatMessage[]
  internalMessages: Message[]
  /** Lines the file holds. Compared against live entities to decide when to compact. */
  records: number
  version: 1 | 2
  /** Lines that could not be parsed — a torn final write, or a bad hand-edit. */
  damaged: number
  /**
   * The file does not end with a line break: a write was cut short, most likely by the app
   * being killed while it waited for the next piece of a long write. Whatever is appended next
   * must start on a line of its own, or it is glued to the torn line and lost with it.
   */
  torn: boolean
}

export type ChatWritePlan =
  | { kind: 'noop' }
  | { kind: 'append'; data: string; records: number }
  | { kind: 'rewrite'; content: string; records: number }

/** How a metadata record starts, which is what makes it findable without parsing every line. */
const META_PREFIX = `{"v":${CHAT_FORMAT_VERSION},"k":"meta"`

const metaLine = (metadata: ChatMetadata): string =>
  JSON.stringify({ v: CHAT_FORMAT_VERSION, k: 'meta', ...metadata })

/**
 * One metadata record, ready to append.
 *
 * For a writer with no session in hand — `CommentService` following a note rename. Appending
 * it updates the file's metadata, because `parseChatMetadata` reads the last such record.
 */
export function serializeMetadata(metadata: ChatMetadata): string {
  return metaLine(metadata) + '\n'
}

/** Optional selections, retained versions and decoration evidence stay on the winning msg.
 * Compaction copies that entire record; it must not rebuild only the conversation fields. */
const messageLine = (message: ChatMessage): string => JSON.stringify({ k: 'msg', ...message })

const internalLine = (message: Message): string => JSON.stringify({ k: 'int', ...message })

/** The whole conversation as a log, for a new file or a compaction. */
export function serializeChat(snapshot: ChatSnapshot): string {
  const lines = [
    metaLine(snapshot.metadata),
    ...snapshot.messages.map(messageLine),
    ...snapshot.internalMessages.map(internalLine),
  ]
  return lines.join('\n') + '\n'
}

function liveRecords(snapshot: ChatSnapshot): number {
  return 1 + snapshot.messages.length + snapshot.internalMessages.length
}

/**
 * Reads either version.
 *
 * A version 2 file starts with a record naming its version; a version 1 file starts with `{`
 * on its own line, which is not valid JSON, or is a whole object with no `v`. Either way the
 * first line settles it without reading the rest twice.
 */
export function parseChat(content: string): ParsedChat {
  const firstLine = content.slice(
    0,
    content.indexOf('\n') === -1 ? undefined : content.indexOf('\n')
  )

  let head: unknown = null
  try {
    head = JSON.parse(firstLine)
  } catch {
    head = null
  }

  const isLog =
    !!head &&
    typeof head === 'object' &&
    (head as { k?: string }).k === 'meta' &&
    typeof (head as { v?: number }).v === 'number'

  return isLog ? parseLog(content) : parseLegacy(content)
}

/**
 * The metadata alone, for the history list.
 *
 * In a log the current metadata is the *last* meta record, not the first — a renamed chat
 * appends a new one. Finding it needs the file's lines but parses only the records that could
 * be metadata, which in a long conversation is a handful out of thousands.
 */
export function parseChatMetadata(content: string): ChatMetadata | null {
  let metadata: ChatMetadata | null = null
  for (const line of content.split('\n')) {
    if (!line.startsWith(META_PREFIX)) continue
    try {
      const { k, v, ...rest } = JSON.parse(line)
      void k
      void v
      metadata = mergeMetadataEvidence(rest as ChatMetadata, metadata)
    } catch {
      continue
    }
  }
  return metadata ?? parseLegacy(content).metadata
}

/** Metadata remains last-wins except for irreversible, disk-recorded attention decisions. */
function mergeMetadataEvidence(current: ChatMetadata, previous: ChatMetadata | null): ChatMetadata {
  const state = current.attention ?? {}
  const prior = previous?.attention ?? {}
  const settled = settledAttention(prior)
  const currentSettled = settledAttention(state)
  const extra = [...settled].filter((id) => !currentSettled.has(id))
  const accepted = Object.entries(prior.tools ?? {}).filter(
    ([id, phase]) => phase !== 'done' && !state.tools?.[id] && !currentSettled.has(id)
  )
  const allSettled = new Set([...settled, ...currentSettled])
  const staleError = state.errors?.some((error) => !error.seen && allSettled.has(error.id))
  const staleQuestion =
    state.question &&
    allSettled.has(state.question.id) &&
    ['waiting', 'interrupted'].includes(state.question.status)
  const attention =
    extra.length || accepted.length || staleError || staleQuestion
      ? {
          ...state,
          ...(extra.length
            ? { resolved: [...new Set([...(state.resolved ?? []), ...extra])] }
            : {}),
          ...(accepted.length
            ? { tools: { ...Object.fromEntries(accepted), ...state.tools } }
            : {}),
          ...(state.errors
            ? {
                errors: state.errors.map((error) =>
                  allSettled.has(error.id) ? { ...error, seen: true } : error
                ),
              }
            : {}),
          ...(state.question &&
          allSettled.has(state.question.id) &&
          ['waiting', 'interrupted'].includes(state.question.status)
            ? { question: { ...state.question, status: 'cancelled' as const } }
            : {}),
        }
      : current.attention
  return {
    ...current,
    ...(attention ? { attention } : {}),
    ...(current.commentId === undefined && previous?.commentId
      ? { commentId: previous.commentId }
      : {}),
    ...(current.commentLocation === undefined &&
    previous?.commentLocation &&
    (current.commentId ?? previous.commentId) === previous.commentId
      ? { commentLocation: previous.commentLocation }
      : {}),
  }
}

function parseLog(content: string): ParsedChat {
  let metadata: ChatMetadata | null = null
  const messages: ChatMessage[] = []
  const positions = new Map<string, number>()
  const internalMessages: Message[] = []
  let records = 0
  let damaged = 0

  for (const line of content.split('\n')) {
    if (!line.trim()) continue

    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      // A write torn by a crash loses its last line and nothing else, which is the point of
      // the format. Anything else here is a hand-edit that went wrong — or a torn line that
      // the next session's first append was glued onto, whose record is still whole at its end.
      damaged++
      const salvaged = salvageGlued(line)
      if (!salvaged) continue
      record = salvaged
    }
    records++

    if (record.k === 'meta') {
      const { k, v, ...rest } = record
      void k
      void v
      metadata = mergeMetadataEvidence(rest as unknown as ChatMetadata, metadata)
    } else if (record.k === 'msg') {
      const { k, ...rest } = record
      void k
      const message = rest as unknown as ChatMessage
      const at = positions.get(message.id)
      if (at === undefined) {
        positions.set(message.id, messages.length)
        messages.push(message)
      } else {
        messages[at] = message
      }
    } else if (record.k === 'int') {
      const { k, ...rest } = record
      void k
      internalMessages.push(rest as unknown as Message)
    }
  }

  return {
    metadata,
    messages,
    internalMessages,
    records,
    version: 2,
    damaged,
    torn: isTorn(content),
  }
}

const isTorn = (content: string): boolean => content.length > 0 && !content.endsWith('\n')

/** Where a record can begin: every line the writer produces starts with one of these. */
const RECORD_START = /\{"(?:k":"(?:msg|int)"|v":\d+,"k":"meta")/g

/**
 * The whole record at the end of a line that starts with a torn one.
 *
 * Builds before 1.46.1 appended straight after whatever the file ended with, so a line cut
 * short by a crash took the first record of the next session's first append down with it. That
 * record is intact from where it starts to the end of the line: inside a JSON string a quote is
 * escaped, so the first unescaped record opening after the start of the line is where it
 * begins.
 */
function salvageGlued(line: string): Record<string, unknown> | null {
  for (const match of line.matchAll(RECORD_START)) {
    if (match.index === 0) continue
    try {
      const record = JSON.parse(line.slice(match.index)) as unknown
      if (record && typeof record === 'object') return record as Record<string, unknown>
    } catch {
      // A record opening inside the torn part, or one torn itself: try the next.
    }
  }
  return null
}

function parseLegacy(content: string): ParsedChat {
  try {
    const data = JSON.parse(content) as {
      metadata?: ChatMetadata
      messages?: ChatMessage[]
      internalMessages?: Message[]
    }
    return {
      metadata: data.metadata ?? null,
      messages: data.messages ?? [],
      internalMessages: data.internalMessages ?? [],
      records: 0,
      version: 1,
      damaged: 0,
      torn: false,
    }
  } catch {
    return {
      metadata: null,
      messages: [],
      internalMessages: [],
      records: 0,
      version: 1,
      damaged: 0,
      torn: isTorn(content),
    }
  }
}

/**
 * Tracks what a chat's file already holds, so a save writes only what changed.
 *
 * One writer per open chat. It is deliberately ignorant of files and I/O: it answers what
 * should be written, and is told afterwards that the write succeeded.
 */
export class ChatLogWriter {
  private metaLine = ''
  private messageLines = new Map<string, string>()
  private internalCount = 0
  /** Exact committed internal records: equal counts alone cannot detect sync edits. */
  private internalLines: string[] = []
  private records = 0
  private legacySnapshot: string | null = null
  /** Whether the file is known to end with a whole line, so an append may start right there. */
  private clean = true

  /** Seeds the writer from a file just read, so the next save appends rather than rewrites. */
  adopt(parsed: ParsedChat): void {
    if (parsed.version !== 2) {
      // A version 1 file is migrated by the first save, which rewrites it as a log.
      this.forget()
      this.legacySnapshot = JSON.stringify([
        parsed.metadata,
        parsed.messages,
        parsed.internalMessages,
      ])
      return
    }

    this.legacySnapshot = null
    this.metaLine = parsed.metadata ? metaLine(parsed.metadata) : ''
    this.messageLines = new Map(parsed.messages.map((m) => [m.id, messageLine(m)]))
    this.internalCount = parsed.internalMessages.length
    this.internalLines = parsed.internalMessages.map(internalLine)
    this.records = parsed.records
    this.clean = !parsed.torn
  }

  /**
   * A write failed part way, or may have: the file can end in a torn line now, so the next
   * append starts with a line break of its own.
   */
  interrupted(): void {
    this.clean = false
  }

  /** Forgets the file, so the next save writes the whole conversation. */
  forget(): void {
    this.legacySnapshot = null
    this.metaLine = ''
    this.messageLines = new Map()
    this.internalCount = 0
    this.internalLines = []
    this.records = 0
    this.clean = true
  }

  /** Whether another writer changed the file since this session last read or saved it. */
  matches(parsed: ParsedChat): boolean {
    if (parsed.version === 1)
      return (
        this.legacySnapshot !== null &&
        this.legacySnapshot ===
          JSON.stringify([parsed.metadata, parsed.messages, parsed.internalMessages])
      )
    return (
      parsed.version === 2 &&
      !!parsed.metadata &&
      metaLine(parsed.metadata) === this.metaLine &&
      parsed.messages.length === this.messageLines.size &&
      parsed.internalMessages.length === this.internalCount &&
      parsed.internalMessages.every(
        (message, i) => this.internalLines[i] === internalLine(message)
      ) &&
      parsed.messages.every((message) => this.messageLines.get(message.id) === messageLine(message))
    )
  }

  /** What the next write should be. Pure: call `commit` once the write has happened. */
  plan(snapshot: ChatSnapshot): ChatWritePlan {
    const live = liveRecords(snapshot)

    if (this.records === 0) {
      return { kind: 'rewrite', content: serializeChat(snapshot), records: live }
    }

    const lines: string[] = []

    const meta = metaLine(snapshot.metadata)
    if (meta !== this.metaLine) lines.push(meta)

    for (const message of snapshot.messages) {
      const line = messageLine(message)
      if (this.messageLines.get(message.id) !== line) lines.push(line)
    }

    for (const message of snapshot.internalMessages.slice(this.internalCount)) {
      lines.push(internalLine(message))
    }

    if (lines.length === 0) return { kind: 'noop' }

    const records = this.records + lines.length
    if (records > live * COMPACTION_RATIO) {
      return { kind: 'rewrite', content: serializeChat(snapshot), records: live }
    }

    // A blank line costs nothing to read back; a record glued to a torn one is lost with it.
    const start = this.clean ? '' : '\n'
    return { kind: 'append', data: start + lines.join('\n') + '\n', records }
  }

  /**
   * Records exactly the bytes that reached the file, never the live snapshot: messages can
   * change while I/O is pending. Such changes must remain outstanding for the next save.
   * The snapshot parameter is retained for callers; only the serialized plan is authoritative.
   */
  commit(_snapshot: ChatSnapshot, plan: ChatWritePlan): void {
    if (plan.kind === 'noop') return
    if (plan.kind === 'rewrite') this.forget()

    const written = plan.kind === 'rewrite' ? plan.content : plan.data
    for (const line of written.split('\n')) {
      // V8 can keep split results as slices of the entire plan, including large tool results.
      // Re-serialize only retained records to independent strings; parse ids from those copies
      // too, so neither map keys nor values keep the plan buffer alive.
      if (line.startsWith(META_PREFIX)) {
        const { k, v, ...metadata } = JSON.parse(line)
        void k
        void v
        const previous = this.metaLine ? (JSON.parse(this.metaLine) as ChatMetadata) : null
        this.metaLine = metaLine(mergeMetadataEvidence(metadata as ChatMetadata, previous))
      } else if (line.startsWith(MSG_START)) {
        const message = JSON.parse(line) as { id: string }
        this.messageLines.set(message.id, JSON.stringify(message))
      } else if (line.startsWith('{"k":"int"')) {
        this.internalLines.push(JSON.stringify(JSON.parse(line)))
        this.internalCount++
      }
    }
    this.records = plan.records
    this.clean = true
  }
}

const MSG_START = '{"k":"msg"'

/** Bump when the cached history dates need to be derived again from existing files. */
export const MESSAGE_TIMES_VERSION = 2

/** Only sent conversation turns date a chat, not maintenance, tools or unsent drafts. */
export function conversationMessageTime(message: Partial<ChatMessage>): number {
  const at = message.timestamp
  if (message.role !== 'user' && message.role !== 'assistant') return 0
  return !message.draft && typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : 0
}

/**
 * When the conversation began and when it was last written in: the earliest and the latest of
 * its sent user and assistant messages' own timestamps, 0 when none have dates.
 *
 * What the history is ordered by. The file's modification time is not: it moves for a new title,
 * a summary, a recap, a note renamed, sync from another device — none of which is somebody
 * writing in the chat. A message rewritten later — a tool's result arriving — keeps the time it
 * was written at, so it moves nothing either. Only message records are parsed; the agent's own
 * records, most of a long chat's file, are skipped by their first characters.
 */
export function messageTimes(content: string): { first: number; last: number } {
  let first = 0
  let last = 0
  const take = (message: Partial<ChatMessage>) => {
    const at = conversationMessageTime(message)
    if (!at) return
    if (!first || at < first) first = at
    if (at > last) last = at
  }

  if (!content.startsWith(META_PREFIX)) {
    for (const message of parseChat(content).messages) take(message)
    return { first, last }
  }
  for (const line of content.split('\n')) {
    if (!line.startsWith(MSG_START)) continue
    try {
      take(JSON.parse(line) as Partial<ChatMessage>)
    } catch {
      // A torn line: the chat skips it too.
    }
  }
  return { first, last }
}
