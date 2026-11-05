import { describe, expect, it } from 'vitest'
import { chatRenderCost } from '@/ai/chatRenderCost'
import type { ChatMessage } from '@/ai/types'

describe('collapsed rendering cost', () => {
  it('counts a folded repeated read as one header and one file, including partial windows', () => {
    const calls = Array.from({ length: 120 }, (_, i) => ({
      id: `sample-${i}`,
      role: 'tool-call',
      content: '',
      toolName: 'read',
      toolParams: { path: 'Samples/shared.md' },
      toolStatus: 'approved',
      toolResult: 'Sample result',
    })) as ChatMessage[]
    const cost = chatRenderCost(calls, () => false)
    expect(cost(0, 120)).toBe(2)
    expect(cost(30, 100)).toBe(2)
    expect(cost(30, 30)).toBe(0)
    expect(chatRenderCost(calls, () => true)(0, 120)).toBe(121)
    const uniqueFiles = calls.map((call, i) => ({
      ...call,
      toolParams: { path: `Samples/file-${i}.md` },
    }))
    expect(chatRenderCost(uniqueFiles, () => false)(0, 120)).toBe(121)
    const images = calls.map((call) => ({
      ...call,
      toolName: 'read_image',
      toolParams: { path: 'Samples/image.png' },
    }))
    expect(chatRenderCost(images, () => false)(0, 120)).toBe(121)
  })
})
