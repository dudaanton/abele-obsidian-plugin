import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DebuggerBinding } from '@/debugger/DebuggerService'
import type { NodeConnection } from '@/node/NodeService'
import { debuggerSnapshot } from '../fixtures/debugger'

it('defers stack inspection while restored record points are being reconciled', async () => {
  const binding = new DebuggerBinding(
    { state: ref('connected'), client: {} } as unknown as NodeConnection,
    'sample-chat',
    'sample-registration'
  )
  const controller = binding.controller
  for (const method of ['refreshApprovals', 'refreshHistory', 'refreshOutput'] as const)
    vi.spyOn(controller, method).mockResolvedValue(undefined as never)
  const stack = vi.spyOn(controller, 'loadStack').mockResolvedValue(undefined)
  try {
    controller.observe({ observation: 'current', snapshot: debuggerSnapshot() })
    // Removing capture metadata precedes the adapter's final auto-continue. Its cached
    // stop now looks ordinary, but stack handles still belong to the completed capture.
    binding.restoringPoints = true
    await binding.refresh(false)
    expect(stack).not.toHaveBeenCalled()
    binding.restoringPoints = false
    await binding.refresh(false)
    expect(stack).toHaveBeenCalledOnce()
  } finally {
    binding.destroy()
  }
})
