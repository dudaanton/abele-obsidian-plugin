import { afterEach, expect, it } from 'vitest'
import { ref } from 'vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { FolderDebugOwner } from '@/debugger/owner'
import { debuggerSnapshot } from '../fixtures/debugger'

const service = new DebuggerService()
afterEach(() => service.destroy())
it('keeps folder sessions independent and uses the selected session for file margins', () => {
  const owner = {
    kind: 'folder-debug',
    target: {
      registrationId: 'sample-registration',
      nodeId: 'sample-node',
      kind: 'worktree',
      id: 'sample-tree',
    },
    connection: { state: ref('connected') },
  } as unknown as FolderDebugOwner
  const first = service.binding(owner, 'sample-first')
  const second = service.binding(owner, 'sample-second')
  expect(first).not.toBe(second)
  for (const [binding, id] of [
    [first, 'sample-first'],
    [second, 'sample-second'],
  ] as const) {
    binding.controller.observe({
      observation: 'current',
      snapshot: debuggerSnapshot({ debug_session_id: id }),
    })
    service.registerSource(
      binding.registrationId,
      binding.conversationId,
      'sample-source',
      'src/sample.ts',
      id,
      'sample-incarnation',
      owner.target
    )
  }
  service.select(second)
  expect(service.folderBinding(owner.target)).toBe(second)
  expect(service.debugFor(owner.target, 'src/sample.ts')?.debugSessionId).toBe('sample-second')
  service.select(first)
  expect(service.folderBinding(owner.target)).toBe(first)
  expect(service.debugFor(owner.target, 'src/sample.ts')?.debugSessionId).toBe('sample-first')
})
