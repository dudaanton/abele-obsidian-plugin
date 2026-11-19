import { expect, it, vi } from 'vitest'
import { chatBlocks } from '@/ai/toolRuns'
import type { ChatMessage } from '@/ai/types'
import { wideScript } from '../e2e/helpers/chatScrollWide'
import type { wideWheelStep } from '../e2e/helpers/wideWheelStep'
import { scrollCompletion } from '../e2e/helpers/scrollCompletion'

vi.mock('../e2e/helpers/shots', () => ({ shotDir: () => 'sample-shots' }))

const runReceipt = async (deliveryAt: number) => {
  let receivedInputs = 0,
    elapsed = 0,
    dispatched = 0
  const el = document.createElement('div')
  // Exercise the serialized helper used in the renderer, rather than slicing
  // executable statements by their whitespace. This fixture isolates delivery;
  // the wheel-step harness separately exercises delayed scroll completion.
  const code = wideScript()
  const start = code.indexOf('    const wheelStep = ')
  const end = code.indexOf('    const completeScroll = ', start)
  if (start < 0 || end <= start) throw Error('Wide wheel helper boundaries changed')
  const step = new Function(`${code.slice(start, end)}; return wheelStep`)() as typeof wideWheelStep
  await step(
    el,
    async () => {
      dispatched++
    },
    () => receivedInputs,
    scrollCompletion,
    async (ms) => {
      elapsed += ms
      if (elapsed >= deliveryAt) receivedInputs = 1
    }
  )
  return { receivedInputs, elapsed, dispatched }
}

it('waits for delayed native receipt after CDP acknowledges without replaying the wheel', async () => {
  const result = await runReceipt(48)
  expect(result.receivedInputs).toBe(1)
  expect(result.dispatched).toBe(1)
  expect(result.elapsed).toBeGreaterThan(48)
})

it('still rejects a wheel that never reaches the chat', async () => {
  await expect(runReceipt(Infinity)).rejects.toThrow('Wide wheel input was not received')
})

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
