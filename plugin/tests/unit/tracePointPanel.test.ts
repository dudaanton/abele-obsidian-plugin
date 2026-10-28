import { expect, it, vi } from 'vitest'
import { savePoint, namesOnLine } from '@/debugger/trace/panel'
import type { DebuggerBinding } from '@/debugger/DebuggerService'

it('offers declarations immediately above the selected line', () => {
  const text =
    'const rate = lookup(quote)\nconst surge = rate * 2\nconst deliveryFee = surge + 5\nreturn quote.total'
  expect(namesOnLine(text, 4)).toEqual(expect.arrayContaining(['rate', 'surge', 'deliveryFee']))
})

it('edits the margin point at its original requested line after relocation', async () => {
  const save = vi.fn(async () => ({ pending: false }))
  const binding = {
    trace: { savePoint: save },
    controller: {
      knownBreakpoints: () => [{ sourceId: 'sample-source', line: 7, requestedLine: 6 }],
    },
  } as unknown as DebuggerBinding
  await savePoint(binding, 'sample-source', 7, { take: ['cart'] })
  expect(save).toHaveBeenCalledWith('sample-source', 6, { take: ['cart'] })
})
