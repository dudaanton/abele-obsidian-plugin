import { expect, it, vi } from 'vitest'
import { chatBlocks } from '@/ai/toolRuns'
import type { ChatMessage } from '@/ai/types'
import { wideScript } from '../e2e/helpers/chatScrollWide'

vi.mock('../e2e/helpers/shots', () => ({ shotDir: () => 'sample-shots' }))

it('keeps the wide fixture tail discoverable with tool runs collapsed', () => {
  const code = wideScript()
  // Execute the actual generated seed, without app, native input or provider access.
  const seed = code.slice(code.indexOf('  const count ='), code.indexOf('  const visibleAnchor ='))
  const { records, tail } = new Function(
    `const size = 'long', records = []; ${seed}; return { records, tail }`
  )() as { records: ChatMessage[]; tail: string }
  const blocks = chatBlocks(records)
  const visibleIds = blocks.map((block) => (block.kind === 'run' ? block.id : block.message.id))
  expect(visibleIds, 'item(tail) must resolve without opening a folded run').toContain(tail)
  expect(blocks.filter((block) => block.kind === 'run').length).toBeGreaterThan(50)
  expect(
    records
      .filter((message) => message.role !== 'tool-call')
      .every((message) => message.content === 'Sample.')
  ).toBe(true)
  // Parse the browser script, but never execute it here.
  expect(() => new Function(code)).not.toThrow()
})
