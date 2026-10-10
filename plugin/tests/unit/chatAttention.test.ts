import { describe, expect, it, vi } from 'vitest'
import { parseChat, parseChatAttention, serializeChat, serializeMetadata } from '@/ai/ChatLog'
import type { ChatMetadata } from '@/ai/types'

const metadata: ChatMetadata = { type: 'abele-chat', providerId: '', modelId: '', created: '' }
const snapshot = (extra: Partial<ChatMetadata> = {}) =>
  serializeChat({
    metadata: { ...metadata, ...extra },
    messages: [],
    internalMessages: [],
  })

describe('cooperative attention projection', () => {
  it('yields within a large transcript and returns no transcript arrays', async () => {
    const text =
      snapshot() +
      Array.from(
        { length: 300 },
        (_, i) =>
          JSON.stringify({
            k: 'int',
            role: 'assistant',
            content: 'Synthetic text '.repeat(1000),
            id: i,
          }) + '\n'
      ).join('')
    const yieldControl = vi.fn().mockResolvedValue(undefined)
    const result = await parseChatAttention(text, yieldControl)
    expect(yieldControl.mock.calls.length).toBeGreaterThan(10)
    expect(result.metadata?.type).toBe('abele-chat')
    expect(result).not.toHaveProperty('messages')
    expect(result).not.toHaveProperty('internalMessages')
    expect(result.damaged).toBe(0)
    expect(result.records).toBe(301)
  })
  it('merges irreversible metadata and last-wins legacy tool results', async () => {
    const text =
      snapshot({ attention: { resolved: ['settled-question'] } }) +
      serializeMetadata({ ...metadata, attention: {} }) +
      JSON.stringify({ k: 'msg', id: 'message-a', toolCallId: 'call-a', toolResult: '' }) +
      '\n' +
      JSON.stringify({ k: 'msg', id: 'message-b', toolCallId: 'call-b', toolStatus: 'rejected' }) +
      '\n' +
      JSON.stringify({ k: 'msg', id: 'message-a', content: 'Replacement without a result' }) +
      '\n'
    const result = await parseChatAttention(text, async () => {})
    expect(result.metadata?.attention?.resolved).toEqual(['settled-question', 'call-b'])
  })
  it.each([
    snapshot() + '{"k":"int","content":',
    snapshot() + 'invalid\n' + serializeMetadata(metadata),
    '',
    JSON.stringify({
      metadata,
      messages: [{ id: 'sample-result', toolCallId: 'call-a', toolResult: '' }],
    }),
  ])('preserves validity and terminal evidence for legacy or damaged files', async (text) => {
    const full = parseChat(text)
    const result = await parseChatAttention(text, async () => {})
    expect(result).toMatchObject({
      version: full.version,
      torn: full.torn,
      damaged: full.damaged,
      records: full.records,
    })
    if (full.version === 1 && full.metadata)
      expect(result.metadata?.attention?.resolved).toContain('call-a')
  })
})
