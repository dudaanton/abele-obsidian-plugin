import {
  anchorFor,
  insertMarker,
  parseMarkers,
  removeMarkerId,
  stripMarkers,
} from '@/editor/commentMarkers'
import { decodeThread, encodeThread, type CommentAppearance, type CommentThread } from './model'

export interface ThreadSnapshot {
  thread: CommentThread
  revision: string
}
/** Writes are compare-and-swap. A null revision means create, never replace. */
export interface CommentRepository {
  read(id: string): Promise<ThreadSnapshot | null>
  write(thread: CommentThread, expected: string | null): Promise<ThreadSnapshot>
  remove(id: string, expected: string): Promise<void>
  ids(): Promise<string[]>
  occupied(id: string): Promise<boolean>
}
export interface CommentDocuments {
  change(path: string, transform: (current: string) => string): Promise<void>
}
export interface CommentDraft {
  thread: CommentThread
  source: string
  from: number
  to: number
  saved?: ThreadSnapshot
}

/** Human comments have no model, chat session, vault API or reactive state. */
export class TextCommentService {
  constructor(
    readonly repository: CommentRepository,
    private readonly documents: CommentDocuments,
    private readonly clock: () => string,
    private readonly nextId: () => string
  ) {}

  async draft(
    note: string,
    source: string,
    from: number,
    to: number,
    appearance: CommentAppearance,
    body: string
  ): Promise<CommentDraft> {
    const anchor = anchorFor(source, to)
    if (!anchor || from < 0 || from >= to || to > source.length)
      throw new Error(
        'Select ordinary note text outside code, frontmatter, tables and callout titles'
      )
    const quote = stripMarkers(source.slice(from, anchor.quoteTo))
    if (!quote.trim()) throw new Error('Select some text to comment on')
    let id = ''
    for (let attempt = 0; attempt < 100; attempt++) {
      id = this.nextId()
      if (!(await this.repository.occupied(id))) break
      id = ''
    }
    if (!id) throw new Error('Unable to allocate a comment id')
    const thread: CommentThread = {
      version: 1,
      id,
      anchor: { note, quote },
      appearance,
      entries: [{ id: this.nextId(), body, createdAt: this.clock() }],
    }
    // Validate before either file can be written.
    decodeThread(encodeThread(thread), id)
    return { thread, source, from, to: anchor.pos }
  }

  /** Persist first; an interrupted publication leaves a recoverable, never-collected file. */
  async publish(draft: CommentDraft): Promise<ThreadSnapshot> {
    draft.saved ??= await this.repository.write(draft.thread, null)
    // Retrying after an external edit must not publish stale appearance/content.
    const current = await this.repository.read(draft.thread.id)
    if (current?.revision !== draft.saved.revision)
      throw new Error('The comment changed elsewhere. Reopen it before saving')
    await this.documents.change(draft.thread.anchor.note, (text) => {
      if (parseMarkers(text).some((marker) => marker.ids.includes(draft.thread.id))) return text
      if (text !== draft.source)
        throw new Error('The selected note text changed. Restore it or select the passage again')
      return insertMarker(text, draft.to, draft.thread.id, draft.from).text
    })
    return draft.saved
  }

  async add(
    saved: ThreadSnapshot,
    body: string,
    appearance = saved.thread.appearance
  ): Promise<ThreadSnapshot> {
    let id = this.nextId()
    while (saved.thread.entries.some((entry) => entry.id === id)) id = this.nextId()
    return this.repository.write(
      {
        ...saved.thread,
        appearance,
        entries: [...saved.thread.entries, { id, body, createdAt: this.clock() }],
      },
      saved.revision
    )
  }

  async edit(
    saved: ThreadSnapshot,
    entryId: string,
    body: string,
    appearance = saved.thread.appearance
  ): Promise<ThreadSnapshot> {
    if (!saved.thread.entries.some((entry) => entry.id === entryId))
      throw new Error('The comment entry is unavailable')
    return this.repository.write(
      {
        ...saved.thread,
        appearance,
        entries: saved.thread.entries.map((entry) =>
          entry.id === entryId ? { ...entry, body, editedAt: this.clock() } : entry
        ),
      },
      saved.revision
    )
  }

  async appearance(saved: ThreadSnapshot, appearance: CommentAppearance): Promise<ThreadSnapshot> {
    return this.repository.write({ ...saved.thread, appearance }, saved.revision)
  }

  async deleteEntry(saved: ThreadSnapshot, entryId: string): Promise<ThreadSnapshot | null> {
    const entries = saved.thread.entries.filter((entry) => entry.id !== entryId)
    if (entries.length === saved.thread.entries.length)
      throw new Error('The comment entry is unavailable')
    if (entries.length) return this.repository.write({ ...saved.thread, entries }, saved.revision)
    const current = await this.repository.read(saved.thread.id)
    if (current?.revision !== saved.revision)
      throw new Error('The comment changed elsewhere. Reopen it before deleting')
    await this.documents.change(saved.thread.anchor.note, (text) =>
      removeMarkerId(text, saved.thread.id)
    )
    await this.repository.remove(saved.thread.id, saved.revision)
    return null
  }

  /** Scan the repository, not the loaded UI cache. Folder moves use path-segment boundaries. */
  async rename(oldPath: string, newPath: string): Promise<void> {
    for (const id of await this.repository.ids()) {
      const saved = await this.repository.read(id)
      if (!saved) continue
      const path = saved.thread.anchor.note
      if (path !== oldPath && !path.startsWith(oldPath + '/')) continue
      await this.repository.write(
        {
          ...saved.thread,
          anchor: { ...saved.thread.anchor, note: newPath + path.slice(oldPath.length) },
        },
        saved.revision
      )
    }
  }
}
