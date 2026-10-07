import { expect, it, vi } from 'vitest'
import {
  NodeFilesModel,
  splitNodeDiff,
  readNodeText,
  nodeResourceTarget,
} from '@/node/NodeFilesModel'
import { MemoryClientStore, type NodeClient, type ReviewBatch } from '@abele/node-client'
import type { DiffSpan } from '@/github/permalinks'
const nodeId = 'node-fixture',
  workspaceId = 'workspace-fixture'
const patch =
  'diff --git a/sample.txt b/sample.txt\n--- a/sample.txt\n+++ b/sample.txt\n@@ -1,2 +1,2 @@\n same\n-old\n+new\n'
function setup() {
  const submitReview = vi.fn(async (_batch: ReviewBatch) => ({ operation_id: 'review-1' }))
  const client = {
    listFiles: vi.fn(async () => ({
      entries: [{ name: 'sample.txt', path: 'sample.txt', kind: 'file', size: 9 }],
      next: null,
    })),
    captureDiff: vi.fn(async () => ({
      diff_id: 'snapshot',
      workspace_id: workspaceId,
      mode: 'head',
      head_commit: 'a'.repeat(40),
      base_commit: null,
      merge_base: null,
      commit: null,
      content_id: 'content',
      size: patch.length,
      created_at: '2026-01-01T00:00:00Z',
    })),
    readDiff: vi.fn(async () => ({ offset: 0, total: patch.length, base64: btoa(patch) })),
    cursor: vi.fn(async () => 3),
    submitReview,
    reviewResult: vi.fn(async () => ({ input_id: 'input', accepted_seq: 4, stale: [true, false] })),
    operationResult: vi.fn(async () => ({ error: 'invalid_anchor' })),
    store: new MemoryClientStore(),
  } as unknown as NodeClient
  return {
    client,
    model: new NodeFilesModel(client, nodeId, workspaceId, 'session-fixture'),
    submitReview,
  }
}
const addComment = async (
  s: ReturnType<typeof setup>,
  path: string,
  span: DiffSpan,
  comment: string
) =>
  s.model.addComment(
    s.model.selectLines(s.model.files.value.find((file) => file.path === path)!, span),
    comment
  )
it('captures once, selects old/new lines across files and submits one immutable batch', async () => {
  const s = setup()
  await s.model.loadDiff('head')
  await addComment(s, 'sample.txt', { side: 'R', start: 2, end: 2 }, 'Explain this')
  await addComment(s, 'sample.txt', { side: 'L', start: 2, end: 2 }, 'Keep this')
  expect(s.client.captureDiff).toHaveBeenCalledTimes(1)
  expect(s.model.comments.value).toMatchObject([
    { diff_id: 'snapshot', side: 'new', start_line: 2 },
    { side: 'old', start_line: 2 },
  ])
  await s.model.submit()
  expect(s.submitReview).toHaveBeenCalledTimes(1)
  expect(s.submitReview.mock.calls[0]![0]).toMatchObject({
    session_id: 'session-fixture',
    observed_seq: 3,
    anchors: [{ comment: 'Explain this' }, { comment: 'Keep this' }],
  })
  expect(s.model.comments.value).toHaveLength(0)
  expect(s.model.reviewStatus.value).toContain('changed')
  expect(s.model.submittedReview.value.map((a) => a.stale)).toEqual([true, false])
})
it('retains a rejected review for editing but fences an unknown outcome against duplicate send', async () => {
  const s = setup()
  await s.model.loadDiff('head')
  await addComment(s, 'sample.txt', { side: 'R', start: 2, end: 2 }, 'Explain')
  vi.mocked(s.client.reviewResult).mockResolvedValue(undefined)
  await s.model.submit()
  await s.model.submit()
  expect(s.submitReview).toHaveBeenCalledTimes(1)
  expect(s.model.pendingReview.value).toBe('review-1')
  expect(s.model.comments.value).toHaveLength(1)
  vi.mocked(s.client.reviewResult).mockRejectedValueOnce(new Error('invalid_anchor'))
  await expect(s.model.checkReview()).rejects.toThrow('invalid_anchor')
  expect(s.model.pendingReview.value).toBe('')
  expect(s.model.comments.value).toHaveLength(1)
})
it('rejects outside-hunk selection and preserves retained comments when another mode is opened', async () => {
  const s = setup()
  await s.model.loadDiff('staged')
  await expect(
    addComment(s, 'sample.txt', { side: 'R', start: 2, end: 3 }, 'Invalid')
  ).rejects.toThrow('invalid_anchor')
  await addComment(s, 'sample.txt', { side: 'R', start: 2, end: 2 }, 'Retain')
  await s.model.loadDiff('unstaged')
  expect(s.model.comments.value[0]?.diff_id).toBe('snapshot')
})
it('does not publish a diff load after its dialog lifetime has ended', async () => {
  const s = setup()
  await s.model.loadDiff('head')
  let resolve!: (snapshot: Awaited<ReturnType<NodeClient['captureDiff']>>) => void
  const snapshot = { ...s.model.snapshot.value!, diff_id: 'closed-dialog-snapshot' }
  vi.mocked(s.client.captureDiff).mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  const controller = new AbortController()
  const loading = s.model.loadDiff('staged', undefined, controller.signal)
  controller.abort()
  resolve(snapshot)
  await loading
  expect(s.model.snapshot.value?.diff_id).toBe('snapshot')
})
it('locks model comment admission during submission and reports only the immutable sent anchors', async () => {
  const s = setup()
  await s.model.loadDiff('head')
  await addComment(s, 'sample.txt', { side: 'R', start: 2, end: 2 }, 'Original comment')
  let release!: () => void
  vi.mocked(s.client.cursor).mockImplementationOnce(
    () =>
      new Promise((r) => {
        release = () => r(3)
      })
  )
  vi.mocked(s.client.reviewResult).mockResolvedValue({
    input_id: 'input',
    accepted_seq: 4,
    stale: [false],
  })
  const submitting = s.model.submit()
  expect(() => s.model.removeComment(0)).toThrow('Waiting')
  await expect(
    addComment(s, 'sample.txt', { side: 'L', start: 2, end: 2 }, 'Late comment')
  ).rejects.toThrow('Waiting')
  release()
  await submitting
  expect(s.submitReview.mock.calls[0]![0].anchors).toHaveLength(1)
  expect(s.model.submittedReview.value).toMatchObject([{ anchor: { comment: 'Original comment' } }])
})
it('captures selection context from the rendered file rather than whichever snapshot is current', async () => {
  const s = setup()
  await s.model.loadDiff('head')
  const rendered = s.model.files.value[0]!
  const selection = s.model.selectLines(rendered, { side: 'R', start: 2, end: 2 })
  vi.mocked(s.client.captureDiff).mockResolvedValue({
    ...s.model.snapshot.value!,
    diff_id: 'later',
  })
  vi.mocked(s.client.readDiff).mockResolvedValue({
    offset: 0,
    total: patch.length,
    base64: btoa(patch.replace('+new', '+alt')),
  })
  await s.model.loadDiff('unstaged')
  await s.model.addComment(selection, 'Explain the original text')
  // Even a late callback from the old renderer keeps its own source document.
  await s.model.addComment(
    s.model.selectLines(rendered, { side: 'R', start: 2, end: 2 }),
    'Old renderer'
  )
  expect(s.model.comments.value.map((a) => a.diff_id)).toEqual(['snapshot', 'snapshot'])
  const expected = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('new'))),
    (b) => b.toString(16).padStart(2, '0')
  ).join('')
  expect(s.model.comments.value.map((a) => a.context_hash)).toEqual([expected, expected])
})
it('parses a single line or inclusive line range separately from the resource path', () => {
  expect(nodeResourceTarget('sample.ts#L12')).toEqual({
    path: 'sample.ts',
    range: { start: 12, end: 12 },
  })
  expect(nodeResourceTarget('sample.ts#L12-L20')).toEqual({
    path: 'sample.ts',
    range: { start: 12, end: 20 },
  })
  expect(nodeResourceTarget('sample.ts#section')).toEqual({ path: 'sample.ts' })
  expect(nodeResourceTarget('sample.ts#L20-L12')).toEqual({ path: 'sample.ts' })
})
it('splits binary and quoted-path files into the existing GitHub diff presentation', () => {
  const binary =
    'diff --git a/image.bin b/image.bin\nBinary files a/image.bin and b/image.bin differ\n'
  const files = splitNodeDiff(patch + binary)
  expect(files.map((f) => f.path)).toEqual(['sample.txt', 'image.bin'])
  expect(files[1]?.diffNote).toContain('Binary')
})
it('bounds paged content and decodes UTF-8 only after joining split-byte chunks', async () => {
  const bytes = new TextEncoder().encode('a€b')
  const read = vi.fn(async (offset: number) => ({
    offset,
    total: bytes.length,
    base64: btoa(String.fromCharCode(...bytes.slice(offset, offset + 2))),
  }))
  expect(await readNodeText(read, 32)).toBe('a€b')
  await expect(
    readNodeText(async () => ({ offset: 0, total: 100, base64: 'YQ==' }), 32)
  ).rejects.toThrow('large')
  await expect(readNodeText(async () => ({ offset: 0, total: 1, base64: '' }), 32)).rejects.toThrow(
    'Incomplete'
  )
})
