import { ref, shallowRef } from 'vue'
import type { NodeClient, DiffMode, DiffSnapshot, ReviewAnchor } from '@abele/node-client'
import { selectedContext, decodePatchPath } from '@abele/node-protocol'
import type { DiffFile } from '@/github/api'
import type { DiffSpan } from '@/github/permalinks'

export interface CodeDocumentSource {
  read(path: string): Promise<{
    text?: string
    contentId: string | null
    size: number
    binary: boolean
    large: boolean
    tooLarge: boolean
  }>
}
export interface DiffSource {
  capture(mode: DiffMode, commit?: string): Promise<{ snapshot: DiffSnapshot; patch: string }>
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
  readonly snapshot = shallowRef<DiffSnapshot | null>(null)
  readonly patch = ref('')
  readonly files = shallowRef<DiffFile[]>([])
  readonly comments = ref<ReviewAnchor[]>([])
  readonly pendingReview = ref('')
  readonly reviewStatus = ref('')
  readonly submittedReview = ref<{ anchor: ReviewAnchor; stale: boolean }[]>([])
  readonly logs = ref<{ commit: string; subject: string }[]>([])
  readonly documents: CodeDocumentSource
  readonly diffs: DiffSource
  private listingGeneration = 0
  private fileGeneration = 0
  private diffGeneration = 0
  private submitting = false
  constructor(
    readonly client: NodeClient,
    readonly nodeId: string,
    readonly workspaceId: string,
    readonly sessionId?: string
  ) {
    this.documents = new NodeDocumentSource(client, workspaceId)
    this.diffs = new NodeDiffSource(client, workspaceId)
  }
  async list(path = '', more = false) {
    const generation = ++this.listingGeneration
    const page = await this.client.listFiles(
      this.workspaceId,
      path,
      more ? (this.next.value ?? undefined) : undefined
    )
    if (generation !== this.listingGeneration) return
    this.directory.value = path
    this.entries.value = more ? [...this.entries.value, ...page.entries] : page.entries
    this.next.value = page.next
  }
  async openFile(path: string) {
    const generation = ++this.fileGeneration
    const doc = await this.documents.read(path)
    if (generation !== this.fileGeneration) return
    this.filePath.value = path
    this.document.value = doc
  }
  async loadDiff(mode: DiffMode, commit?: string) {
    const generation = ++this.diffGeneration
    const result = await this.diffs.capture(mode, commit)
    if (generation !== this.diffGeneration) return
    this.snapshot.value = result.snapshot
    this.patch.value = result.patch
    this.files.value = splitNodeDiff(result.patch)
  }
  async loadLog(more = false) {
    const rows = await this.client.gitLog(this.workspaceId, more ? this.logs.value.length : 0)
    this.logs.value = more ? [...this.logs.value, ...rows] : rows
  }
  async addComment(path: string, span: DiffSpan, comment: string) {
    const snapshot = this.snapshot.value
    if (!snapshot) throw new Error('Open a diff before selecting lines')
    if (this.pendingReview.value) throw new Error('Waiting for the submitted review')
    const range = {
      path,
      side: span.side === 'L' ? ('old' as const) : ('new' as const),
      start_line: span.start,
      end_line: span.end,
    }
    const context = selectedContext(this.patch.value, range)
    const context_hash = await contextHash(context)
    if (!comment.trim()) throw new Error('Enter a comment')
    this.comments.value.push({
      node_id: this.nodeId,
      workspace_id: this.workspaceId,
      diff_id: snapshot.diff_id,
      ...range,
      context_hash,
      comment: comment.trim(),
    })
  }
  async submit() {
    if (this.submitting) return
    if (this.pendingReview.value) return this.checkReview()
    if (!this.sessionId) throw new Error('Open a workspace session before sending a review')
    if (!this.comments.value.length) return
    this.submitting = true
    try {
      const { operation_id } = await this.client.submitReview({
        session_id: this.sessionId,
        observed_seq: await this.client.cursor(this.sessionId),
        anchors: this.comments.value.map((a) => ({ ...a })),
      })
      this.pendingReview.value = operation_id
      await this.checkReview()
    } finally {
      this.submitting = false
    }
  }
  async checkReview() {
    if (!this.pendingReview.value) return
    try {
      const result = await this.client.reviewResult(this.pendingReview.value)
      if (!result) {
        this.reviewStatus.value =
          'Queued review · waiting for confirmation. Reconnect to check; do not send it again.'
        return
      }
      this.reviewStatus.value = result.stale.some(Boolean)
        ? 'Review accepted · the workspace changed; retained selections were sent and marked stale.'
        : 'Review accepted as one session input.'
      this.submittedReview.value = this.comments.value.map((anchor, i) => ({
        anchor: { ...anchor },
        stale: result.stale[i] ?? false,
      }))
      this.comments.value = []
      this.pendingReview.value = ''
    } catch (e) {
      // Only a durable terminal rejection permits a new edited batch, never a read/storage error.
      const receipt = await this.client.operationResult(this.pendingReview.value)
      if (receipt?.error) this.pendingReview.value = ''
      throw e
    }
  }
}
