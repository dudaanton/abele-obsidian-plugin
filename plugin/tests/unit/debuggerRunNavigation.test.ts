import { afterEach, expect, it } from 'vitest'
import { ref } from 'vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { debuggerSnapshot } from '../fixtures/debugger'

afterEach(() => DebuggerService.instance.destroy())

it('finds the debugger of the run rather than the currently active debugger', () => {
  const service = DebuggerService.instance
  const bind = (registrationId: string, sessionId: string) => {
    const binding = service.binding({
      reference: { registrationId, sessionId: 'sample-chat' },
      connection: { state: ref('connected'), client: {} },
    } as unknown as NodeChatPresenter)
    binding.controller.observe({
      observation: 'current',
      snapshot: debuggerSnapshot({ debug_session_id: sessionId }),
    })
    return binding
  }
  const own = bind('sample-node-a', 'sample-session')
  const other = bind('sample-node-b', 'sample-session')
  service.select(other)
  expect(service.forRun('sample-node-a', 'sample-project', 'sample-session')).toBe(own)
  expect(service.forRun('sample-node-a', 'other-project', 'sample-session')).toBeUndefined()
  expect(service.forRun('sample-node-a', 'sample-project', 'other-session')).toBeUndefined()
  expect(service.forRun('unknown-node', 'sample-project', 'sample-session')).toBeUndefined()
})
