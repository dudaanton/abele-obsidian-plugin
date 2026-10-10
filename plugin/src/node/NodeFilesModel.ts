import { computed, readonly, ref, shallowRef, markRaw } from 'vue'
import type { NodeClient, DiffMode, DiffSnapshot, ReviewAnchor } from '@abele/node-client'
import {
  selectedContext,
  decodePatchPath,
  ReviewAnchorSchema,
  ReviewBatchSchema,
  FileWriteSchema,
  RepositoryWriteSchema,
} from '@abele/node-protocol'
import type { DiffFile } from '@/github/api'
import type { DiffSpan } from '@/github/permalinks'
import { type FileDraft, type FileDraftSnapshot, type DraftReceipt } from './fileDrafts'
const draftConflict =
  'Local draft changed in another view. Copy your visible text before reloading the shared draft.'
const assertDraftRevision = (draft: FileDraft | undefined, revision: string | null) => {
  if ((draft?.revision ?? null) !== revision) throw new Error(draftConflict)
}
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
    text: string,
    expectedRevision?: string | null,
    guard?: () => void
  ): Promise<FileDraft>
  save(path: string, shown?: FileDraftSnapshot): Promise<FileDraft | undefined>
  check(path: string, expectedRevision?: string | null): Promise<FileDraft | undefined>
  rebase(
    path: string,
    document: Awaited<ReturnType<CodeDocumentSource['read']>>,
    expectedRevision?: string | null
  ): Promise<FileDraft>
  discard(path: string, expectedRevision?: string | null): Promise<void>
  predecessor?(receipt: DraftReceipt): Promise<string>
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
  private readonly observed = new Map<string, FileDraft | undefined>()
  constructor(
    private client: NodeClient,
    private workspaceId: string,
    private repository = false
  ) {}
  private parseWrite(path: string, contentId: string | null, text: string) {
    const body = { path, expected_content_id: contentId, text }
    return this.repository
      ? RepositoryWriteSchema.safeParse({ ...body, worktree_id: this.workspaceId })
      : FileWriteSchema.safeParse({ ...body, workspace_id: this.workspaceId })
  }
  private async transaction<T>(
    path: string,
    work: (drafts: Record<string, FileDraft>, key: string) => T | Promise<T>
  ): Promise<T> {
    const committed = await this.client.store.transaction(async (state) => {
      const local = state as typeof state & { fileDrafts?: Record<string, FileDraft> }
      const drafts = (local.fileDrafts ??= {}),
        key = JSON.stringify(
          this.repository ? ['repository', this.workspaceId, path] : [this.workspaceId, path]
        )
      // Memory adapters and old persisted records both migrate without losing their text.
      if (drafts[key] && !drafts[key].revision) drafts[key].revision = crypto.randomUUID()
      const value = await work(drafts, key)
      return { value, snapshot: structuredClone(drafts[key]) }
    })
    this.observed.set(path, committed.snapshot)
    return committed.value
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
    const params = this.parseWrite(path, doc.contentId, text)
    if (!params.success)
      throw new Error(
        'The text editor accepts existing UTF-8 files up to 32768 characters, outside Git metadata'
      )
    return params.data
  }
  async edit(
    path: string,
    doc: Awaited<ReturnType<CodeDocumentSource['read']>>,
    text: string,
    expectedRevision = this.observed.get(path)?.revision ?? null,
    guard?: () => void
  ) {
    if (text.length > 16 * 1024 * 1024)
      throw new Error('Local draft exceeds the retained-content limit; copy it before closing')
    return this.transaction(path, (drafts, key) => {
      guard?.()
      const previous = drafts[key]
      assertDraftRevision(previous, expectedRevision)
      if (!previous || previous.status === 'saved') this.writable(path, doc, doc.text ?? '')
      // Existing drafts belong to their retained baseline, even when current contents became
      // binary/large. Editing them locally never adopts that new file version implicitly.
      if (previous?.pending)
        throw new Error('This save is unresolved; check its original outcome before editing')
      const draft: FileDraft = {
        ...(previous && previous.status !== 'saved'
          ? previous
          : { baseContentId: doc.contentId!, baseText: doc.text! }),
        revision: crypto.randomUUID(),
        text,
        status: previous?.status === 'conflict' ? 'conflict' : 'draft',
        error: undefined,
      }
      return (drafts[key] = draft)
    })
  }
  async save(path: string, shown: FileDraftSnapshot | undefined = this.observed.get(path)) {
    if (!shown) return undefined
    const draft = await this.transaction(path, (drafts, key) => {
      const draft = drafts[key]
      assertDraftRevision(draft, shown.revision)
      if (!draft || draft.text !== shown.text || draft.baseContentId !== shown.baseContentId)
        throw new Error(draftConflict)
      if (draft.pending || draft.status === 'saved') return draft
      if (draft.status === 'conflict')
        throw new Error(
          'Inspect the current version and explicitly use it as the base before saving again'
        )
      const parsed = this.parseWrite(path, shown.baseContentId, shown.text)
      if (!parsed.success)
        throw new Error(
          'This draft exceeds the UTF-8 save limit of 32768 characters or contains unsupported text. Your local draft is retained.'
        )
      draft.revision = crypto.randomUUID()
      draft.pending = { operationId: crypto.randomUUID(), params: parsed.data }
      draft.result = undefined
      draft.error = undefined
      draft.status = 'outcome_unknown'
      return draft
    })
    return draft?.pending ? this.check(path, draft.revision) : draft
  }
  async check(path: string, expectedRevision = this.observed.get(path)?.revision ?? null) {
    const draft = await this.transaction(path, (drafts, key) => {
        assertDraftRevision(drafts[key], expectedRevision)
        return drafts[key]
      }),
      pending = draft?.pending
    if (!pending) return draft
    // Identity/body were committed before outbox admission. Resume that same operation even
    // after reload or failure in the tiny gap between those local transactions.
    if (!draft.result && !(await this.client.operationResult(pending.operationId))) {
      if ('worktree_id' in pending.params)
        await this.client.repository.write(pending.params, pending.operationId)
      else await this.client.writeFile(pending.params, pending.operationId)
    }
    let result: DraftReceipt | undefined, error: string | undefined
    try {
      result = this.repository
        ? await this.client.repository.mutationResult(pending.operationId)
        : await this.client.fileMutationResult(pending.operationId)
    } catch (e) {
      const receipt = await this.client.operationResult(pending.operationId)
      if (!receipt?.error) throw e
      error = receipt.error
    }
    if (
      result &&
      (result.operation_id !== pending.operationId ||
        (this.repository
          ? !('worktree_id' in result) || result.worktree_id !== this.workspaceId
          : !('workspace_id' in result) || result.workspace_id !== this.workspaceId) ||
        result.path !== path ||
        result.expected_content_id !== pending.params.expected_content_id)
    )
      throw new Error('Invalid file save receipt identity')
    return this.transaction(path, (drafts, key) => {
      const current = drafts[key]
      if (!current) throw new Error(draftConflict)
      if (current.pending?.operationId !== pending.operationId) {
        if (
          current.result?.operation_id === pending.operationId &&
          current.text === pending.params.text &&
          ['saved', 'conflict', 'rejected'].includes(current.status)
        )
          return current
        throw new Error(draftConflict)
      }
      if (!result && !error) {
        current.status = 'outcome_unknown'
        return current
      }
      const nextStatus = error ? 'rejected' : result!.state
      if (
        current.status === nextStatus &&
        current.error === error &&
        JSON.stringify(current.result) === JSON.stringify(result)
      )
        return current
      current.revision = crypto.randomUUID()
      current.error =
        error === 'unsupported_file_metadata'
          ? 'File access metadata cannot be preserved. Files with ACLs or unsupported extended attributes are not saved.'
          : error
      current.result = result
      current.status = nextStatus
      if (result?.state === 'saved') {
        current.baseContentId = result.content_id
        current.baseText = pending.params.text
      }
      if (error || result?.state !== 'outcome_unknown') current.pending = undefined
      return current
    })
  }
  rebase(
    path: string,
    doc: Awaited<ReturnType<CodeDocumentSource['read']>>,
    expectedRevision = this.observed.get(path)?.revision ?? null
  ) {
    return this.transaction(path, (drafts, key) => {
      const current = drafts[key]
      assertDraftRevision(current, expectedRevision)
      if (!current || current.pending)
        throw new Error('This save is unresolved; cannot change its precondition')
      this.writable(path, doc, doc.text ?? '')
      current.revision = crypto.randomUUID()
      current.baseContentId = doc.contentId!
      current.baseText = doc.text!
      current.status = 'draft'
      current.error = undefined
      return current
    })
  }
  discard(path: string, expectedRevision = this.observed.get(path)?.revision ?? null) {
    return this.transaction(path, (drafts, key) => {
      assertDraftRevision(drafts[key], expectedRevision)
      if (drafts[key]?.pending)
        throw new Error('This save is unresolved; keep its draft and evidence')
      delete drafts[key]
    })
  }
  async predecessor(receipt: DraftReceipt) {
    if (this.repository)
      return readNodeText(
        (offset) =>
          receipt.recovery_path
            ? this.client.repository.readRecovery({
                worktree_id: this.workspaceId,
                recovery_path: receipt.recovery_path,
                offset,
              })
            : this.client.repository.content({
                worktree_id: this.workspaceId,
                content_id: receipt.predecessor_content_id!,
                offset,
              }),
        16 * 1024 * 1024
      )
    return readNodeText(
      (offset) =>
        receipt.recovery_path?.startsWith('file-recovery/')
          ? this.client.readRecovery(this.workspaceId, receipt.recovery_path, offset)
          : this.client.readContent(this.workspaceId, receipt.predecessor_content_id!, offset),
      16 * 1024 * 1024
    )
  }
  async read(path: string) {
    if (this.repository) {
      const target = { worktree_id: this.workspaceId }
      const { revision } = await this.client.repository.observe(target)
      const content = await this.client.repository.blob({ ...target, revision, path })
      return {
        text:
          content.content_id && !content.binary && !content.requires_larger_load
            ? await readNodeText(
                (offset) =>
                  this.client.repository.content({
                    ...target,
                    content_id: content.content_id!,
                    offset,
                  }),
                1024 * 1024
              )
            : undefined,
        contentId: content.content_id,
        size: content.size,
        binary: content.binary,
        large: content.requires_larger_load,
        tooLarge: content.too_large,
      }
    }
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
  private editGeneration = 0
  readonly canReloadDraft = computed(
    () => !this.draftError.value || this.draftError.value === draftConflict
  )
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
    readonly sessionId?: string,
    documents?: CodeDocumentSource
  ) {
    // Models own explicit refs and transactional stores; Vue must not recursively proxy them.
    markRaw(this)
    this.documents = documents ?? new NodeDocumentSource(client, workspaceId)
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
  async openFile(
    path: string,
    signal?: AbortSignal,
    range?: CodeLineRange,
    loaded?: Awaited<ReturnType<CodeDocumentSource['read']>>
  ) {
    await this.persistingEdit.catch((e) => {
      if (!(e instanceof Error) || e.message !== draftConflict || path !== this.filePath.value)
        throw e
    })
    const generation = ++this.fileGeneration,
      editsAtStart = this.editGeneration
    let draft = await this.documents.draft(path)
    let doc: Awaited<ReturnType<CodeDocumentSource['read']>>
    try {
      doc = loaded ?? (await this.documents.read(path))
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
    // Read shared drafts after the network read and all intervening local writes, not before.
    await this.persistingEdit.catch((e) => {
      if (
        !(e instanceof Error) ||
        e.message !== draftConflict ||
        editsAtStart !== this.editGeneration
      )
        throw e
    })
    draft = await this.documents.draft(path)
    if (generation !== this.fileGeneration || signal?.aborted) return
    const keepTyped = this.filePath.value === path && editsAtStart !== this.editGeneration
    this.filePath.value = path
    this.document.value = doc
    if (!keepTyped) {
      this.draft.value = draft
      this.draftText.value = draft?.text ?? doc.text ?? ''
      this.editing.value = !!draft && draft.status !== 'saved'
      this.draftError.value = ''
      this.persistingEdit = Promise.resolve()
    }
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
      await this.documents.discard(path, draft.revision)
      draft = undefined
    }
    draft ??= await this.documents.edit(path, doc, doc.text ?? '', null)
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
    const expectedAtInput = this.draft.value?.revision ?? null
    this.editGeneration++
    this.draftText.value = text
    // Promise entry catches synchronous validation throws too. Serialize our own keystrokes,
    // but CAS against the shared store so another model's revision is never silently adopted.
    const task = this.persistingEdit
      .catch(() => {})
      .then(() =>
        this.documents.edit(
          path,
          doc,
          text,
          generation === this.fileGeneration && path === this.filePath.value
            ? (this.draft.value?.revision ?? null)
            : expectedAtInput
        )
      )
      .then((draft) => {
        if (generation === this.fileGeneration) {
          this.draft.value = draft
          this.draftError.value = ''
        }
      })
      .catch((e: unknown) => {
        if (generation === this.fileGeneration)
          this.draftError.value =
            e instanceof Error && e.message === draftConflict
              ? draftConflict
              : 'Local draft could not be stored. Keep this window open and copy your text before closing.'
        throw e
      })
    this.persistingEdit = task
    return task
  }
  private acceptOperationDraft(draft: FileDraft | undefined, completed?: FileDraft) {
    // A revision is meaningful only together with the text/base the editor shows. Never
    // acknowledge an intervening shared edit through a finally-only metadata refresh.
    if (
      (draft?.text ?? '') !== this.draftText.value ||
      (completed && draft?.revision !== completed.revision) ||
      (!completed &&
        draft &&
        this.draft.value &&
        draft.baseContentId !== this.draft.value.baseContentId)
    ) {
      this.draftError.value = draftConflict
      throw new Error(draftConflict)
    }
    this.draft.value = draft
  }
  async saveFile() {
    if (this.saving.value) return
    const path = this.filePath.value,
      generation = this.fileGeneration,
      text = this.draftText.value
    let localConflict = false,
      completed: FileDraft | undefined,
      admissionStarted = false
    this.saving.value = true
    try {
      await this.persistingEdit
      if (generation !== this.fileGeneration)
        throw new Error('File view changed before save admission')
      const draft = this.draft.value
      admissionStarted = !!draft
      if (draft)
        completed = await this.documents.save(path, {
          revision: draft.revision,
          text,
          baseContentId: draft.baseContentId,
        })
      if (generation === this.fileGeneration && completed)
        this.acceptOperationDraft(completed, completed)
    } catch (e) {
      localConflict = e instanceof Error && e.message === draftConflict
      if (localConflict) this.draftError.value = draftConflict
      throw e
    } finally {
      try {
        if (!localConflict && admissionStarted) {
          const draft = await this.documents.draft(path)
          if (generation === this.fileGeneration) this.acceptOperationDraft(draft, completed)
        }
      } finally {
        this.saving.value = false
      }
    }
  }
  async checkSave() {
    const path = this.filePath.value,
      generation = this.fileGeneration
    let localConflict = false,
      completed: FileDraft | undefined
    try {
      completed = await this.documents.check(path, this.draft.value?.revision ?? null)
      if (generation === this.fileGeneration && completed)
        this.acceptOperationDraft(completed, completed)
    } catch (e) {
      localConflict = e instanceof Error && e.message === draftConflict
      if (localConflict) this.draftError.value = draftConflict
      throw e
    } finally {
      if (!localConflict) {
        const draft = await this.documents.draft(path)
        if (generation === this.fileGeneration) this.acceptOperationDraft(draft, completed)
      }
    }
  }
  draftSnapshot(): FileDraftSnapshot | null {
    const draft = this.draft.value
    return draft
      ? { revision: draft.revision, text: this.draftText.value, baseContentId: draft.baseContentId }
      : null
  }
  private async currentForReconciliation(shown: FileDraftSnapshot | null) {
    const path = this.filePath.value,
      generation = this.fileGeneration
    const check = () => {
      if (generation !== this.fileGeneration || path !== this.filePath.value)
        throw new Error('File view changed before draft reconciliation')
      assertDraftRevision(this.draft.value, shown?.revision ?? null)
      if (
        shown &&
        (this.draftText.value !== shown.text ||
          this.draft.value?.baseContentId !== shown.baseContentId)
      )
        throw new Error(draftConflict)
      if (this.draft.value?.pending)
        throw new Error('This save is unresolved; keep its draft and evidence')
    }
    await this.persistingEdit
    check()
    // An explicit reconciliation must read disk, not fall back to a retained baseline offline.
    const document = await this.documents.read(path)
    await this.persistingEdit
    check()
    return { path, generation, document }
  }
  async reloadCurrent(shown: FileDraftSnapshot | null = this.draftSnapshot()) {
    if (this.draftError.value === draftConflict) {
      // The visible failed-CAS copy is not the shared draft. Forget only that private copy,
      // after a successful current read, and load the other view's draft without deleting it.
      const path = this.filePath.value,
        generation = this.fileGeneration
      const document = await this.documents.read(path)
      if (generation !== this.fileGeneration) throw new Error('File view changed before reload')
      await this.openFile(path, undefined, this.fileRange.value, document)
      return
    }
    const { path, generation, document } = await this.currentForReconciliation(shown)
    await this.documents.discard(path, shown?.revision ?? null)
    if (generation !== this.fileGeneration) return
    this.document.value = document
    this.draft.value = undefined
    this.draftText.value = document.text ?? ''
    this.editing.value = false
    this.draftError.value = ''
    this.predecessorText.value = undefined
  }
  async keepMine(shown: FileDraftSnapshot | null = this.draftSnapshot()) {
    if (!shown) throw new Error('There is no local draft to keep')
    const { path, generation, document } = await this.currentForReconciliation(shown)
    const draft = await this.documents.rebase(path, document, shown.revision)
    if (generation !== this.fileGeneration) return
    this.document.value = document
    this.draft.value = draft
    this.editing.value = true
    this.draftError.value = ''
  }
  async rebaseDraft() {
    const path = this.filePath.value,
      doc = this.document.value,
      generation = this.fileGeneration
    await this.persistingEdit
    if (!doc) return
    const draft = await this.documents.rebase(path, doc, this.draft.value?.revision ?? null)
    if (generation === this.fileGeneration) this.draft.value = draft
  }
  async discardDraft() {
    const path = this.filePath.value,
      generation = this.fileGeneration
    await this.persistingEdit
    await this.documents.discard(path, this.draft.value?.revision ?? null)
    if (generation !== this.fileGeneration) return
    this.draft.value = undefined
    this.draftText.value = this.document.value?.text ?? ''
    this.editing.value = false
  }
  async readPredecessor() {
    const receipt = this.draft.value?.result,
      content = receipt?.predecessor_content_id,
      generation = this.fileGeneration
    if (!content) return
    const text = this.documents.predecessor
      ? await this.documents.predecessor(receipt!)
      : await readNodeText(
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
    // A known invalid length must not wait for WebCrypto before surfacing the rejection.
    if (comment.trim().length > 2000)
      throw new Error(
        'Review exceeds node limits: at most 32 comments, 200 lines and 2000 characters per comment'
      )
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
