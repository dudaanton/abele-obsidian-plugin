import { TextCommentService, type ThreadSnapshot } from '@/comments/service'
import { decodeThread, encodeThread, type CommentThread } from '@/comments/model'

/** Synthetic dialog state; no fixture save can touch the real vault. */
export function textCommentFixture(existing = false) {
  const thread: CommentThread = {
    version: 1,
    id: 'aaaaaa',
    anchor: {
      note: 'Notes/sample.md',
      quote: 'An invented passage with enough words to wrap on a narrow screen.',
    },
    appearance: 'yellow',
    entries: Array.from({ length: 8 }, (_, i) => ({
      id: String(i + 1).padStart(6, '0'),
      body: `**Sample entry ${i + 1}**\n\nA long invented comment with a [sample link](https://example.com) and several words that wrap on a narrow screen.\n\n- First point\n- Second point`,
      createdAt: '2025-01-02T03:04:05.000Z',
      ...(i === 0 ? { editedAt: '2025-01-03T04:05:06.000Z' } : {}),
    })),
  }
  let stored: ThreadSnapshot | null = existing ? { thread, revision: encodeThread(thread) } : null
  let serial = 10
  const service = new TextCommentService(
    {
      async read() {
        return stored
      },
      async write(value, expected) {
        if ((stored?.revision ?? null) !== expected) throw new Error('The sample comment changed')
        const revision = encodeThread(value)
        stored = { thread: decodeThread(revision, value.id), revision }
        return stored
      },
      async remove() {
        stored = null
      },
      async ids() {
        return stored ? [stored.thread.id] : []
      },
      async occupied() {
        return false
      },
    },
    { async change() {} },
    () => '2025-01-04T05:06:07.000Z',
    () => String(++serial).padStart(6, '0')
  )
  return {
    service,
    ...(existing
      ? { initial: stored }
      : {
          selection: {
            note: thread.anchor.note,
            source: thread.anchor.quote,
            from: 0,
            to: thread.anchor.quote.length,
          },
        }),
  }
}
