import { computed, readonly, ref, shallowRef } from 'vue'
import type { NodeClient, DiffMode, DiffSnapshot, ReviewAnchor } from '@abele/node-client'
import {
  selectedContext,
  decodePatchPath,
  ReviewAnchorSchema,
  ReviewBatchSchema,
  FileWriteSchema,
} from '@abele/node-protocol'
import type { DiffFile } from '@/github/api'
import type { DiffSpan } from '@/github/permalinks'
import { type FileDraft } from './fileDrafts'
export type { FileDraft } from './fileDrafts'

export interface CodeDocumentSource {
  read(path: string): Promise<{
    text?: string
    contentId: string | null
    size: number
    binary: boolean
    large: boolean
    tooLarge: boolean
  }>
  draft(path: string): Promise<FileDraft | undefined>
  edit(
    path: string,
    document: Awaited<ReturnType<CodeDocumentSource['read']>>,
    text: string
  ): Promise<FileDraft>
  save(path: string): Promise<FileDraft | undefined>
  check(path: string): Promise<FileDraft | undefined>
  rebase(
    path: string,
    document: Awaited<ReturnType<CodeDocumentSource['read']>>
  ): Promise<FileDraft>
  discard(path: string): Promise<void>
}
export interface DiffSource {
  capture(mode: DiffMode, commit?: string): Promise<{ snapshot: DiffSnapshot; patch: string }>
}
export interface CodeLineRange {
  start: number
  end: number
}
export function nodeResourceTarget(resource: string): { path: string; range?: CodeLineRange } {
  const separator = resource.indexOf('#')
  if (separator < 0) return { path: resource }
  const path = resource.slice(0, separator),
    match = resource.slice(separator + 1).match(/^L([1-9]\d*)(?:-L([1-9]\d*))?$/)
  if (!match) return { path }
  const start = Number(match[1]),
    end = Number(match[2] ?? match[1])
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start
    ? { path, range: { start, end } }
    : { path }
}
export interface DiffDocument {
  readonly snapshot: Readonly<DiffSnapshot>
  readonly patch: string
}
export interface NodeDiffFile extends DiffFile {
  readonly document: DiffDocument
}
export interface ReviewSelection {
  readonly diffId: string
  readonly path: string
  readonly span: Readonly<DiffSpan>
  readonly context: string
}
/** Bounded byte assembly, not per-chunk decoding (a chunk can split a UTF-8 character). */
export async function readNodeText(
  read: (offset: number) => Promise<{ offset: number; total: number; base64: string }>,
  maxBytes: number
): Promise<string> {
  const chunks: Uint8Array[] = []
  let offset = 0,
    total: number | undefined
  do {
    const part = await read(offset)
    if (
      part.offset !== offset ||
      !Number.isSafeInteger(part.total) ||
      part.total < offset ||
      part.total > maxBytes ||
      (total !== undefined && total !== part.total)
    )
      throw new Error('Invalid or too large node content')
    total = part.total
    const bytes = Uint8Array.from(atob(part.base64), (c) => c.charCodeAt(0))
    if (bytes.length > 131072 || offset + bytes.length > total || (!bytes.length && offset < total))
      throw new Error('Incomplete node content')
    chunks.push(bytes)
    offset += bytes.length
  } while (offset < total)
  const all = new Uint8Array(offset)
  let start = 0
  for (const chunk of chunks) {
    all.set(chunk, start)
    start += chunk.length
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(all)
}
export class NodeDocumentSource implements CodeDocumentSource {
  constructor(
    private client: NodeClient,
    private workspaceId: string
  ) {}
  private transaction<T>(
    path: string,
    work: (drafts: Record<string, FileDraft>, key: string) => T | Promise<T>
  ): Promise<T> {
    return this.client.store.transaction((state) => {
      const local = state as typeof state & { fileDrafts?: Record<string, FileDraft> }
      return work((local.fileDrafts ??= {}), JSON.stringify([this.workspaceId, path]))
    })
  }
  draft(path: string) {
    return this.transaction(path, (drafts, key) => drafts[key])
  }
  private writable(
    path: string,
    doc: Awaited<ReturnType<CodeDocumentSource['read']>>,
    text: string
  ) {
    if (doc.binary || doc.tooLarge || doc.text === undefined || doc.text.length > 32768)
      throw new Error('This file is not editable in the bounded text editor')
    const params = FileWriteSchema.safeParse({
      workspace_id: this.workspaceId,
      path,
      expected_content_id: doc.contentId,
      text,
    })
    if (!params.success)
      throw new Error(
        'The text editor accepts existing UTF-8 files up to 32768 characters, outside Git metadata'
      )
    return params.data
  }
  edit(path: string, doc: Awaited<ReturnType<CodeDocumentSource['read']>>, text: string) {
    this.writable(path, doc, doc.text ?? '')
    if (text.length > 16 * 1024 * 1024)
      throw new Error('Local draft exceeds the retained-content limit; copy it before closing')
    return this.transaction(path, (drafts, key) => {
      const previous = drafts[key]
      if (previous?.pending)
        throw new Error('This save is unresolved; check its original outcome before editing')
      const draft: FileDraft = {
        ...(previous ?? { baseContentId: doc.contentId!, baseText: doc.text! }),
        text,
        status: previous?.status === 'conflict' ? 'conflict' : 'draft',
        error: undefined,
      }
      return (drafts[key] = draft)
    })
  }
  async save(path: string) {
    const draft = await this.transaction(path, (drafts, key) => {
      const draft = drafts[key]
      if (!draft || draft.pending || draft.status === 'saved') return draft
      if (draft.status === 'conflict')
        throw new Error(
          'Inspect the current version and explicitly use it as the base before saving again'
        )
      const parsed = FileWriteSchema.safeParse({
        workspace_id: this.workspaceId,
        path,
        expected_content_id: draft.baseContentId,
        text: draft.text,
      })
      if (!parsed.success)
        throw new Error(
          'This draft exceeds the UTF-8 save limit of 32768 characters or contains unsupported text. Your local draft is retained.'
        )
      draft.pending = { operationId: crypto.randomUUID(), params: parsed.data }
      draft.result = undefined
      draft.error = undefined
      draft.status = 'outcome_unknown'
      return draft
    })
    return draft?.pending ? this.check(path) : draft
  }
  async check(path: string) {
    const draft = await this.draft(path),
      pending = draft?.pending
    if (!pending) return draft
    // Identity/body were committed before outbox admission. Resume that same operation even
    // after reload or failure in the tiny gap between those local transactions.
    if (!(await this.client.operationResult(pending.operationId)))
      await this.client.writeFile(pending.params, pending.operationId)
    let result: Awaited<ReturnType<NodeClient['fileMutationResult']>>, error: string | undefined
    try {
      result = await this.client.fileMutationResult(pending.operationId)
    } catch (e) {
      const receipt = await this.client.operationResult(pending.operationId)
      if (!receipt?.error) throw e
      error = receipt.error
    }
    if (
      result &&
      (result.operation_id !== pending.operationId ||
        result.workspace_id !== this.workspaceId ||
        result.path !== path ||
        result.expected_content_id !== pending.params.expected_content_id)
    )
      throw new Error('Invalid file save receipt identity')
    return this.transaction(path, (drafts, key) => {
      const current = drafts[key]
      if (!current || current.pending?.operationId !== pending.operationId) return current
      if (!result && !error) {
        current.status = 'outcome_unknown'
        return current
      }
      current.error = error
      current.result = result
      current.status = error ? 'rejected' : result!.state
      if (result?.state === 'saved') {
        current.baseContentId = result.content_id
        current.baseText = pending.params.text
      }
      if (error || result?.state !== 'outcome_unknown') current.pending = undefined
      return current
    })
  }
  rebase(path: string, doc: Awaited<ReturnType<CodeDocumentSource['read']>>) {
    return this.transaction(path, (drafts, key) => {
      const current = drafts[key]
      if (!current || current.pending)
        throw new Error('This save is unresolved; cannot change its precondition')
      this.writable(path, doc, doc.text ?? '')
      current.baseContentId = doc.contentId!
      current.baseText = doc.text!
      current.status = 'draft'
      current.error = undefined
      return current
    })
  }
  discard(path: string) {
    return this.transaction(path, (drafts, key) => {
      if (drafts[key]?.pending)
        throw new Error('This save is unresolved; keep its draft and evidence')
      delete drafts[key]
    })
  }
  async read(path: string) {
    const content = await this.client.readFile(this.workspaceId, path)
    const text =
      content.content_id && !content.binary
        ? await readNodeText(
            (offset) => this.client.readContent(this.workspaceId, content.content_id!, offset),
            16 * 1024 * 1024
          )
        : undefined
    return {
      text,
      contentId: content.content_id,
      size: content.size,
      binary: content.binary,
      large: content.large,
      tooLarge: content.too_large,
    }
  }
}
export class NodeDiffSource implements DiffSource {
  constructor(
    private client: NodeClient,
    private workspaceId: string
  ) {}
  async capture(mode: DiffMode, commit?: string) {
    const snapshot = await this.client.captureDiff(this.workspaceId, mode, commit)
    const patch = await readNodeText(
      (offset) => this.client.readDiff(this.workspaceId, snapshot.diff_id, offset),
      8 * 1024 * 1024
    )
    return { snapshot, patch }
  }
}
/** Adapt a retained unified patch to the existing GitHub file/diff renderer. */
export function splitNodeDiff(patch: string): DiffFile[] {
  return patch
    .split(/(?=^diff --git )/m)
    .filter((p) => p.startsWith('diff --git '))
    .map((part, i): DiffFile => {
      const header = part.split('\n')[0]!.slice('diff --git '.length)
      // With --no-renames, both paths are identical except the a/b prefix (including quoting).
      const encoded = header.slice(0, (header.length - 1) / 2)
      const path = decodePatchPath(encoded)
      const binary = /^Binary files /m.test(part)
      return {
        path,
        hash: 'node-file-' + i,
        status: part.includes('\nnew file mode ')
          ? 'added'
          : part.includes('\ndeleted file mode ')
            ? 'removed'
            : 'modified',
        additions: part.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
        deletions: part.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
        patch: binary ? undefined : part,
        diffNote: binary ? 'Binary file changed; text lines cannot be selected.' : undefined,
        reviewComments: [],
      }
    })
}
const contextHash = async (text: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, '0')
  ).join('')
export class NodeFilesModel {
  readonly entries = ref<Awaited<ReturnType<NodeClient['listFiles']>>['entries']>([])
  readonly next = ref<string | null>(null)
  readonly directory = ref('')
  readonly document = shallowRef<Awaited<ReturnType<CodeDocumentSource['read']>> | null>(null)
  readonly filePath = ref('')
  readonly draft = shallowRef<FileDraft>()
  readonly draftText = ref('')
  readonly editing = ref(false)
  readonly saving = ref(false)
  readonly draftError = ref('')
  readonly predecessorText = ref<string>()
  private persistingEdit: Promise<unknown> = Promise.resolve()
  readonly draftDirty = computed(
    () => !!this.draft.value && this.draftText.value !== this.draft.value.baseText
  )
  readonly fileEditable = computed(() => {
    const doc = this.document.value
    return (
      !!doc &&
      !doc.binary &&
      !doc.tooLarge &&
      doc.text !== undefined &&
      FileWriteSchema.safeParse({
        workspace_id: this.workspaceId,
        path: this.filePath.value,
        expected_content_id: doc.contentId,
        text: doc.text,
      }).success
    )
  })
  readonly fileRange = shallowRef<CodeLineRange>()
  readonly snapshot = shallowRef<DiffSnapshot | null>(null)
  readonly patch = ref('')
  readonly files = shallowRef<NodeDiffFile[]>([])
  private readonly draftComments = shallowRef<readonly ReviewAnchor[]>(Object.freeze([]))
  readonly comments = readonly(this.draftComments)
  readonly pendingReview = ref('')
  readonly reviewStatus = ref('')
  readonly submittedReview = ref<{ anchor: ReviewAnchor; stale: boolean }[]>([])
  readonly logs = ref<{ commit: string; subject: string }[]>([])
  readonly documents: CodeDocumentSource
  readonly diffs: DiffSource
  private listingGeneration = 0
  private fileGeneration = 0
  private diffGeneration = 0
  private logGeneration = 0
  private readonly submitting = ref(false)
  readonly reviewLocked = computed(() => this.submitting.value || !!this.pendingReview.value)
  private sentAnchors?: readonly ReviewAnchor[]
  constructor(
    readonly client: NodeClient,
    readonly nodeId: string,
    readonly workspaceId: string,
    readonly sessionId?: string
  ) {
    this.documents = new NodeDocumentSource(client, workspaceId)
    this.diffs = new NodeDiffSource(client, workspaceId)
  }
  async list(path = '', more = false, signal?: AbortSignal) {
    const generation = ++this.listingGeneration
    const page = await this.client.listFiles(
      this.workspaceId,
      path,
      more ? (this.next.value ?? undefined) : undefined
    )
    if (generation !== this.listingGeneration || signal?.aborted) return
    this.directory.value = path
    this.entries.value = more ? [...this.entries.value, ...page.entries] : page.entries
    this.next.value = page.next
  }
  async openFile(path: string, signal?: AbortSignal, range?: CodeLineRange) {
    await this.persistingEdit
    const generation = ++this.fileGeneration
    const draft = await this.documents.draft(path)
    let doc: Awaited<ReturnType<CodeDocumentSource['read']>>
    try {
      doc = await this.documents.read(path)
    } catch (e) {
      if (!draft) throw e
      // Even offline/reopened views can display the original local base and unsent text.
      doc = {
        text: draft.baseText,
        contentId: draft.baseContentId,
        size: new TextEncoder().encode(draft.baseText).length,
        binary: false,
        large: false,
        tooLarge: false,
      }
    }
    if (generation !== this.fileGeneration || signal?.aborted) return
    this.filePath.value = path
    this.document.value = doc
    this.draft.value = draft
    this.draftText.value = draft?.text ?? doc.text ?? ''
    this.editing.value = !!draft && draft.status !== 'saved'
    this.draftError.value = ''
    this.predecessorText.value = undefined
    const lines = doc.text?.split('\n').length ?? 0
    // Do not allocate decorations for a hostile billion-line fragment or retarget an absent line.
    this.fileRange.value =
      range && range.start <= lines
        ? { start: range.start, end: Math.min(range.end, lines) }
        : undefined
  }
  async beginEditing() {
    const path = this.filePath.value,
      doc = this.document.value,
      generation = this.fileGeneration
    if (!doc || !this.fileEditable.value) throw new Error('This file is not editable')
    let draft = await this.documents.draft(path)
    if (draft?.status === 'saved') {
      // A confirmed old save is history, not an unsent edit of the newly loaded version.
      await this.documents.discard(path)
      draft = undefined
    }
    draft ??= await this.documents.edit(path, doc, doc.text ?? '')
    if (generation !== this.fileGeneration) return
    this.draft.value = draft
    this.draftText.value = this.draft.value.text
    this.editing.value = true
  }
  editText(text: string) {
    const path = this.filePath.value,
      doc = this.document.value,
      generation = this.fileGeneration
    if (!doc || this.saving.value || this.draft.value?.pending)
      return Promise.reject(new Error('This save is unresolved'))
    this.draftText.value = text
    const task = this.documents
      .edit(path, doc, text)
      .then((draft) => {
        if (generation === this.fileGeneration) {
          this.draft.value = draft
          this.draftError.value = ''
        }
      })
      .catch((e: unknown) => {
        if (generation === this.fileGeneration)
          this.draftError.value =
            'Local draft could not be stored. Keep this window open and copy your text before closing.'
        throw e
      })
    this.persistingEdit = task
    return task
  }
  async saveFile() {
    if (this.saving.value) return
    const path = this.filePath.value,
      generation = this.fileGeneration
    this.saving.value = true
    try {
      await this.persistingEdit
      await this.documents.save(path)
    } finally {
      try {
        const draft = await this.documents.draft(path)
        if (generation === this.fileGeneration) this.draft.value = draft
      } finally {
        this.saving.value = false
      }
    }
  }
  async checkSave() {
    const path = this.filePath.value,
      generation = this.fileGeneration
    try {
      await this.documents.check(path)
    } finally {
      const draft = await this.documents.draft(path)
      if (generation === this.fileGeneration) this.draft.value = draft
    }
  }
  async rebaseDraft() {
    const path = this.filePath.value,
      doc = this.document.value,
      generation = this.fileGeneration
    await this.persistingEdit
    if (!doc) return
    const draft = await this.documents.rebase(path, doc)
    if (generation === this.fileGeneration) this.draft.value = draft
  }
  async discardDraft() {
    const path = this.filePath.value,
      generation = this.fileGeneration
    await this.persistingEdit
    await this.documents.discard(path)
    if (generation !== this.fileGeneration) return
    this.draft.value = undefined
    this.draftText.value = this.document.value?.text ?? ''
    this.editing.value = false
  }
  async readPredecessor() {
    const content = this.draft.value?.result?.predecessor_content_id,
      generation = this.fileGeneration
    if (!content) return
    const text = await readNodeText(
      (offset) => this.client.readContent(this.workspaceId, content, offset),
      16 * 1024 * 1024
    )
    if (generation === this.fileGeneration) this.predecessorText.value = text
  }
  openResource(resource: string, signal?: AbortSignal) {
    const target = nodeResourceTarget(resource)
    return this.openFile(target.path, signal, target.range)
  }
  async loadDiff(mode: DiffMode, commit?: string, signal?: AbortSignal) {
    const generation = ++this.diffGeneration
    const result = await this.diffs.capture(mode, commit)
    if (generation !== this.diffGeneration || signal?.aborted) return
    const document = Object.freeze({
      snapshot: Object.freeze({ ...result.snapshot }),
      patch: result.patch,
    })
    this.snapshot.value = document.snapshot
    this.patch.value = document.patch
    this.files.value = splitNodeDiff(document.patch).map((file) => ({ ...file, document }))
  }
  async loadLog(more = false, signal?: AbortSignal) {
    const generation = ++this.logGeneration
    const rows = await this.client.gitLog(this.workspaceId, more ? this.logs.value.length : 0)
    if (generation !== this.logGeneration || signal?.aborted) return
    this.logs.value = more ? [...this.logs.value, ...rows] : rows
  }
  selectLines(file: NodeDiffFile, span: DiffSpan): ReviewSelection {
    // Validate the protocol's actual anchor bounds before exposing a commentable selection.
    if (
      !ReviewAnchorSchema.safeParse({
        node_id: this.nodeId,
        workspace_id: this.workspaceId,
        diff_id: file.document.snapshot.diff_id,
        path: file.path,
        side: span.side === 'L' ? 'old' : 'new',
        start_line: span.start,
        end_line: span.end,
        context_hash: '0'.repeat(64),
        comment: 'selection',
      }).success
    )
      throw new Error('invalid_anchor: select no more than 200 lines for one comment')
    const context = selectedContext(file.document.patch, {
      path: file.path,
      side: span.side === 'L' ? 'old' : 'new',
      start_line: span.start,
      end_line: span.end,
    })
    return Object.freeze({
      diffId: file.document.snapshot.diff_id,
      path: file.path,
      span: Object.freeze({ ...span }),
      context,
    })
  }
  private assertEditable() {
    if (this.reviewLocked.value) throw new Error('Waiting for the submitted review')
  }
  removeComment(index: number) {
    this.assertEditable()
    this.draftComments.value = Object.freeze(this.draftComments.value.filter((_, i) => i !== index))
  }
  async addComment(selection: ReviewSelection, comment: string) {
    this.assertEditable()
    const context_hash = await contextHash(selection.context)
    this.assertEditable() // Submission may have started while WebCrypto was pending.
    if (!comment.trim()) throw new Error('Enter a comment')
    const anchor = {
      node_id: this.nodeId,
      workspace_id: this.workspaceId,
      diff_id: selection.diffId,
      path: selection.path,
      side: selection.span.side === 'L' ? ('old' as const) : ('new' as const),
      start_line: selection.span.start,
      end_line: selection.span.end,
      context_hash,
      comment: comment.trim(),
    }
    const candidate = [...this.draftComments.value, anchor]
    if (
      !ReviewBatchSchema.safeParse({
        session_id: this.sessionId ?? 'browse-only',
        observed_seq: 0,
        anchors: candidate,
      }).success
    )
      throw new Error(
        'Review exceeds node limits: at most 32 comments, 200 lines and 2000 characters per comment'
      )
    this.draftComments.value = Object.freeze([...this.draftComments.value, Object.freeze(anchor)])
  }
  async submit() {
    if (this.submitting.value) return
    if (this.pendingReview.value) return this.checkReview()
    if (!this.sessionId) throw new Error('Open a workspace session before sending a review')
    if (!this.comments.value.length) return
    const anchors = Object.freeze(
      this.draftComments.value.map((anchor) => Object.freeze({ ...anchor }))
    )
    this.submitting.value = true
    try {
      const { operation_id } = await this.client.submitReview({
        session_id: this.sessionId,
        observed_seq: await this.client.cursor(this.sessionId),
        anchors: anchors.map((anchor) => ({ ...anchor })),
      })
      this.sentAnchors = anchors
      this.pendingReview.value = operation_id
      await this.checkReview()
    } finally {
      this.submitting.value = false
    }
  }
  async checkReview() {
    const operation = this.pendingReview.value,
      anchors = this.sentAnchors
    if (!operation || !anchors) return
    try {
      const result = await this.client.reviewResult(operation)
      if (this.pendingReview.value !== operation) return
      if (!result) {
        this.reviewStatus.value =
          'Queued review · waiting for confirmation. Reconnect to check; do not send it again.'
        return
      }
      this.reviewStatus.value = result.stale.some(Boolean)
        ? 'Review accepted · the workspace changed or could not be rechecked; retained selections were sent and marked stale.'
        : 'Review accepted as one session input.'
      this.submittedReview.value = anchors.map((anchor, i) => ({
        anchor: { ...anchor },
        stale: result.stale[i] ?? false,
      }))
      this.draftComments.value = Object.freeze([])
      this.pendingReview.value = ''
      this.sentAnchors = undefined
    } catch (e) {
      // Only a durable terminal rejection permits a new edited batch, never a read/storage error.
      const receipt = await this.client.operationResult(operation)
      if (receipt?.error && this.pendingReview.value === operation) {
        this.pendingReview.value = ''
        this.sentAnchors = undefined
      }
      throw e
    }
  }
}
