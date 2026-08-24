import type { ChatMessage, ChatMetadata } from './types'
import type { Message } from './client'

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
}

export type ChatWritePlan =
  | { kind: 'noop' }
  | { kind: 'append'; data: string; records: number }
  | { kind: 'rewrite'; content: string; records: number }

/** How a metadata record starts, which is what makes it findable without parsing every line. */
const META_PREFIX = `{"v":${CHAT_FORMAT_VERSION},"k":"meta"`

const metaLine = (metadata: ChatMetadata): string =>
  JSON.stringify({ v: CHAT_FORMAT_VERSION, k: 'meta', ...metadata })

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
  const lines = content.split('\n')

  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].startsWith(META_PREFIX)) continue
    try {
      const { k, v, ...rest } = JSON.parse(lines[i])
      void k
      void v
      return rest as ChatMetadata
    } catch {
      continue
    }
  }

  return parseLegacy(content).metadata
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
      // the format. Anything else here is a hand-edit that went wrong.
      damaged++
      continue
    }
    records++

    if (record.k === 'meta') {
      const { k, v, ...rest } = record
      void k
      void v
      metadata = rest as unknown as ChatMetadata
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

  return { metadata, messages, internalMessages, records, version: 2, damaged }
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
    }
  } catch {
    return {
      metadata: null,
      messages: [],
      internalMessages: [],
      records: 0,
      version: 1,
      damaged: 0,
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
  private records = 0

  /** Seeds the writer from a file just read, so the next save appends rather than rewrites. */
  adopt(parsed: ParsedChat): void {
    if (parsed.version !== 2) {
      // A version 1 file is migrated by the first save, which rewrites it as a log.
      this.forget()
      return
    }

    this.metaLine = parsed.metadata ? metaLine(parsed.metadata) : ''
    this.messageLines = new Map(parsed.messages.map((m) => [m.id, messageLine(m)]))
    this.internalCount = parsed.internalMessages.length
    this.records = parsed.records
  }

  /** Forgets the file, so the next save writes the whole conversation. */
  forget(): void {
    this.metaLine = ''
    this.messageLines = new Map()
    this.internalCount = 0
    this.records = 0
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

    return { kind: 'append', data: lines.join('\n') + '\n', records }
  }

  /** Records that the planned write reached the file. */
  commit(snapshot: ChatSnapshot, plan: ChatWritePlan): void {
    if (plan.kind === 'noop') return

    this.metaLine = metaLine(snapshot.metadata)
    this.messageLines = new Map(snapshot.messages.map((m) => [m.id, messageLine(m)]))
    this.internalCount = snapshot.internalMessages.length
    this.records = plan.records
  }
}
