import { z } from 'zod'
import { caseKey } from '@abele/sync-sdk/protocol'
import { configurationPath, executablePath, type ExecutablePaths } from './stagedPluginCode'
import {
  ReviewDocuments,
  reviewId,
  localReviewPath,
  reviewSourceSchema,
  rootConnection,
  sourceIdentity,
  type ReviewSource,
  type ReviewState,
} from './reviewState'

export const ATTACHMENT_CONSENT_KEY = 'token-attachment-consent-v1'
const targetSchema = z
  .object({
    id: reviewId,
    path: localReviewPath,
    kind: z.enum(['attachment', 'canvas', 'note', 'script', 'settings']),
  })
  .strict()
export type ConsentTarget = z.infer<typeof targetSchema>
export interface ConsentResolvePort {
  /** Resolve the stable LOCAL identity, never a same-path replacement or another server's ID. */
  resolve(fileId: string): Promise<ConsentTarget | null>
}
const questionSchema = z
  .object({
    id: reviewId,
    source: reviewSourceSchema,
    fileId: reviewId,
    path: localReviewPath,
    noteIds: z.array(reviewId),
  })
  .strict()
export type AttachmentQuestion = z.infer<typeof questionSchema>
const documentSchema = z
  .object({
    version: z.literal(1),
    sources: z.array(reviewSourceSchema),
    notes: z.array(
      z
        .object({
          connectionId: reviewId,
          noteId: reviewId,
          fileIds: z.array(reviewId),
          kind: z.enum(['note', 'canvas']),
        })
        .strict()
    ),
    received: z.array(z.object({ connectionId: reviewId, fileId: reviewId }).strict()),
    decisions: z.array(
      z.object({ connectionId: reviewId, fileId: reviewId, allow: z.boolean() }).strict()
    ),
    questions: z.array(questionSchema),
  })
  .strict()
type Document = z.infer<typeof documentSchema>
const initial: Document = {
  version: 1,
  sources: [],
  notes: [],
  received: [],
  decisions: [],
  questions: [],
}
function remember(doc: Document, source: ReviewSource): void {
  source = reviewSourceSchema.parse(source)
  const prior = doc.sources.find((one) => one.id === source.id)
  if (prior && sourceIdentity(prior) !== sourceIdentity(source))
    throw new Error('Attachment connection binding changed')
  if (prior) Object.assign(prior, source)
  else doc.sources.push(source)
}
const sameFile =
  (source: ReviewSource, fileId: string) => (one: { connectionId: string; fileId: string }) =>
    one.connectionId === source.id && one.fileId === fileId
const linked = (doc: Document, question: AttachmentQuestion) =>
  doc.notes.some(
    (note) =>
      note.connectionId === question.source.id &&
      note.kind === 'note' &&
      question.noteIds.includes(note.noteId) &&
      note.fileIds.includes(question.fileId)
  )

/** Consent is an explicit note-open effect, independent of arrival/indexing and publication scans. */
export class AttachmentConsent {
  private readonly documents: ReviewDocuments
  constructor(
    store: ReviewState,
    private readonly paths: ExecutablePaths = {}
  ) {
    this.documents = new ReviewDocuments(store)
  }
  updatePaths(paths: ExecutablePaths): void {
    Object.assign(this.paths, paths)
  }
  private eligible(source: ReviewSource, target: ConsentTarget): boolean {
    return (
      (target.kind === 'attachment' || target.kind === 'canvas') &&
      !executablePath(target.path, false, this.paths) &&
      (rootConnection(source) || !configurationPath(target.path, this.paths))
    )
  }
  async observeNote(
    source: ReviewSource,
    noteId: string,
    fileIds: readonly string[],
    kind: 'note' | 'canvas' = 'note'
  ): Promise<void> {
    reviewId.parse(noteId)
    const ids = [...new Set(fileIds.map((id) => reviewId.parse(id)))]
    await this.documents.update(ATTACHMENT_CONSENT_KEY, documentSchema, initial, (doc): null => {
      remember(doc, source)
      const note = doc.notes.find(
        (note) => note.connectionId === source.id && note.noteId === noteId
      )
      if (note) Object.assign(note, { fileIds: ids, kind })
      else doc.notes.push({ connectionId: source.id, noteId, fileIds: ids, kind })
      return null
    })
  }
  /** Proven received bytes establish provenance only for the delivering connection. */
  async recordReceived(source: ReviewSource, fileId: string): Promise<void> {
    reviewId.parse(fileId)
    await this.documents.update(ATTACHMENT_CONSENT_KEY, documentSchema, initial, (doc): null => {
      remember(doc, source)
      if (!doc.received.some(sameFile(source, fileId)))
        doc.received.push({ connectionId: source.id, fileId })
      doc.questions = doc.questions.filter(
        (one) => one.source.id !== source.id || one.fileId !== fileId
      )
      return null
    })
  }
  async mayUpload(source: ReviewSource, target: ConsentTarget): Promise<boolean> {
    reviewSourceSchema.parse(source)
    targetSchema.parse(target)
    if (!rootConnection(source) && configurationPath(target.path, this.paths)) return false
    const doc = await this.documents.read(ATTACHMENT_CONSENT_KEY, documentSchema, initial)
    const prior = doc.sources.find((one) => one.id === source.id)
    if (prior && sourceIdentity(prior) !== sourceIdentity(source))
      throw new Error('Attachment connection binding changed')
    if (source.scope.kind === 'folder') {
      if (rootConnection(source)) return true
      const root = caseKey(source.scope.path.replace(/^\/+|\/+$/g, '')),
        path = caseKey(target.path)
      return path === root || path.startsWith(root + '/')
    }
    if (!this.eligible(source, target)) return false
    return (
      doc.received.some(sameFile(source, target.id)) ||
      doc.decisions.some((one) => sameFile(source, target.id)(one) && one.allow)
    )
  }
  /** The UI/host calls this only for a real note-open event. Merely reading pending() never asks. */
  async noteOpened(
    source: ReviewSource,
    noteId: string,
    port: ConsentResolvePort
  ): Promise<AttachmentQuestion[]> {
    if (source.scope.kind !== 'group') return []
    const before = await this.documents.read(ATTACHMENT_CONSENT_KEY, documentSchema, initial)
    const note = before.notes.find(
      (one) => one.connectionId === source.id && one.noteId === noteId && one.kind === 'note'
    )
    if (!note) return []
    const targets: ConsentTarget[] = []
    for (const fileId of note.fileIds) {
      const resolved = await port.resolve(fileId)
      if (!resolved) continue
      const target = targetSchema.parse(resolved)
      if (target.id === fileId && this.eligible(source, target)) targets.push(target)
    }
    return this.documents.update(ATTACHMENT_CONSENT_KEY, documentSchema, initial, (doc) => {
      remember(doc, source)
      const current = doc.notes.find(
        (one) => one.connectionId === source.id && one.noteId === noteId && one.kind === 'note'
      )
      if (!current) return []
      const questions: AttachmentQuestion[] = []
      for (const target of targets) {
        if (
          !current.fileIds.includes(target.id) ||
          doc.received.some(sameFile(source, target.id)) ||
          doc.decisions.some(sameFile(source, target.id))
        )
          continue
        let question = doc.questions.find(
          (one) => one.source.id === source.id && one.fileId === target.id
        )
        if (!question) {
          question = {
            id: crypto.randomUUID(),
            source: structuredClone(source),
            fileId: target.id,
            path: target.path,
            noteIds: [noteId],
          }
          doc.questions.push(question)
        } else {
          question.path = target.path
          if (!question.noteIds.includes(noteId)) question.noteIds.push(noteId)
        }
        questions.push(question)
      }
      return questions
    })
  }
  async pending(): Promise<AttachmentQuestion[]> {
    const doc = await this.documents.read(ATTACHMENT_CONSENT_KEY, documentSchema, initial)
    return doc.questions.filter((question) => linked(doc, question))
  }
  state(): Promise<Document> {
    return this.documents.read(ATTACHMENT_CONSENT_KEY, documentSchema, initial)
  }
  async decide(
    id: string,
    allow: boolean,
    port: ConsentResolvePort,
    allowed: () => boolean = () => true
  ): Promise<boolean> {
    const before = await this.documents.read(ATTACHMENT_CONSENT_KEY, documentSchema, initial),
      question = before.questions.find((one) => one.id === id)
    if (!question || !linked(before, question)) return false
    const resolved = await port.resolve(question.fileId)
    if (!resolved) return false
    const target = targetSchema.parse(resolved)
    if (target.id !== question.fileId || !this.eligible(question.source, target)) return false
    return this.documents.update(ATTACHMENT_CONSENT_KEY, documentSchema, initial, (doc) => {
      if (!allowed()) return false
      const current = doc.questions.find((one) => one.id === id)
      if (!current || !linked(doc, current)) return false
      doc.decisions = doc.decisions.filter((one) => !sameFile(current.source, current.fileId)(one))
      doc.decisions.push({ connectionId: current.source.id, fileId: current.fileId, allow })
      doc.questions = doc.questions.filter((one) => one.id !== id)
      return true
    })
  }
}
