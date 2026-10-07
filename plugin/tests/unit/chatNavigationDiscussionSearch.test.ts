import { describe, expect, it, vi } from 'vitest'
import { searchNavigationDiscussions } from '@/ai/chatNavigationDiscussionSearch'
import type { ChatMessage } from '@/ai/types'
const message = (id: string, content: string): ChatMessage => ({
  id,
  role: 'user',
  content,
  timestamp: 1,
})

describe('explicit discussion search', () => {
  it('reads reachable discussions on demand once, reports progress and unavailable files, and stops cycles', async () => {
    const read = vi.fn(async (id: string) =>
      id === 'missing'
        ? null
        : {
            messages: [message('q', `${id} pond question`)],
            comments:
              id === 'first'
                ? [
                    { id: 'second', message: 'q' },
                    { id: 'missing', message: 'q', quote: 'sample missing passage' },
                  ]
                : [{ id: 'first', message: 'q' }],
          }
    )
    const progress: { done: number; total: number }[] = []
    const result = await searchNavigationDiscussions({
      query: 'pond',
      seeds: [
        { id: 'first', message: 'root' },
        { id: 'first', message: 'other' },
      ],
      read,
      onProgress: (p) => progress.push(p),
    })
    expect(read.mock.calls.map((c) => c[0])).toEqual(['first', 'second', 'missing'])
    expect(result.hits.map((h) => [h.discussionId, h.messageId])).toEqual([
      ['first', 'q'],
      ['second', 'q'],
    ])
    expect(result.unavailable.map((u) => u.discussionId)).toEqual(['missing'])
    expect(result.unavailable[0].label).toContain('sample missing passage')
    expect(progress.at(-1)).toEqual({ done: 3, total: 3 })
    expect(result.canceled).toBe(false)
  })

  it('does not read anything for an empty query and excludes nested anchors on hidden paths by default', async () => {
    const read = vi.fn(async () => ({
      messages: [message('visible', 'pond')],
      comments: [{ id: 'hidden', message: 'hidden-answer' }],
    }))
    expect(
      (
        await searchNavigationDiscussions({
          query: '',
          seeds: [{ id: 'first', message: 'root' }],
          read,
        })
      ).hits
    ).toEqual([])
    expect(read).not.toHaveBeenCalled()
    await searchNavigationDiscussions({
      query: 'pond',
      seeds: [{ id: 'first', message: 'root' }],
      read,
    })
    expect(read.mock.calls).toHaveLength(1)
  })

  it('searches hidden discussion continuations only under the explicit all-branches scope', async () => {
    const visible = message('q', 'visible question')
    const alt = { ...message('alt', 'pond alternate answer'), parentId: 'q' }
    const read = vi.fn(async () => ({
      messages: [visible],
      allMessages: [visible, alt],
      comments: [],
    }))
    const options = { query: 'pond', seeds: [{ id: 'first', message: 'root' }], read }
    expect((await searchNavigationDiscussions(options)).hits).toEqual([])
    const result = await searchNavigationDiscussions({ ...options, allBranches: true })
    expect(result.hits.map((h) => h.messageId)).toEqual(['alt'])
  })

  it('cancels an in-flight read without publishing late matches or loading descendants', async () => {
    let finish!: (data: {
      messages: ChatMessage[]
      comments: { id: string; message: string }[]
    }) => void
    const waiting = new Promise<{
      messages: ChatMessage[]
      comments: { id: string; message: string }[]
    }>((resolve) => {
      finish = resolve
    })
    const read = vi.fn(() => waiting)
    const onHit = vi.fn()
    const controller = new AbortController()
    const search = searchNavigationDiscussions({
      query: 'pond',
      seeds: [{ id: 'first', message: 'root' }],
      read,
      signal: controller.signal,
      onHit,
    })
    controller.abort()
    finish({ messages: [message('q', 'pond')], comments: [{ id: 'nested', message: 'q' }] })
    const result = await search
    expect(result.canceled).toBe(true)
    expect(result.hits).toEqual([])
    expect(read).toHaveBeenCalledOnce()
    expect(onHit).not.toHaveBeenCalled()
  })
})
