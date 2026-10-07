import { decodeThread, encodeThread } from '@/comments/model'
import {
  TextCommentService,
  type CommentRepository,
  type CommentDocuments,
} from '@/comments/service'

export function memoryComments() {
  const files = new Map<string, string>()
  const notes = new Map([['Notes/sample.md', 'sample words']])
  let serial = 0
  let now = '2025-01-02T03:04:05.000Z'
  let failDocument = false
  const repository: CommentRepository = {
    async read(id) {
      const revision = files.get(id)
      return revision === undefined ? null : { thread: decodeThread(revision, id), revision }
    },
    async write(thread, expected) {
      if ((files.get(thread.id) ?? null) !== expected) throw new Error('stale')
      const revision = encodeThread(thread)
      files.set(thread.id, revision)
      return { thread, revision }
    },
    async remove(id, expected) {
      if (files.get(id) !== expected) throw new Error('stale')
      files.delete(id)
    },
    async ids() {
      return [...files.keys()]
    },
    async occupied(id) {
      return files.has(id) || id === 'zzzzzz'
    },
  }
  const documents: CommentDocuments = {
    async change(path, transform) {
      if (failDocument) throw new Error('document failed')
      const text = notes.get(path)
      if (text === undefined) throw new Error('missing note')
      notes.set(path, transform(text))
    },
  }
  const service = new TextCommentService(
    repository,
    documents,
    () => now,
    () => (++serial).toString(36).padStart(6, '0')
  )
  return {
    service,
    repository,
    files,
    notes,
    clock: (value: string) => {
      now = value
    },
    failDocument: (value: boolean) => {
      failDocument = value
    },
  }
}
