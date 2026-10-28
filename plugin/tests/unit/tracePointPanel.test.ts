import { expect, it, vi } from 'vitest'
import { savePoint } from '@/debugger/trace/panel'
import type { DebuggerBinding } from '@/debugger/DebuggerService'

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
