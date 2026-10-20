import { afterEach, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import DebuggerView from '@/debugger/DebuggerView.vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { FolderDebugOwner } from '@/debugger/owner'
import { debuggerSnapshot } from '../fixtures/debugger'
vi.mock('@/debugger/register', () => ({ showSession: vi.fn(async () => {}) }))
import { showSession } from '@/debugger/register'

afterEach(() => {
  DebuggerService.instance.destroy()
  vi.restoreAllMocks()
})
it.each(['running', 'detached', 'exited'] as const)(
  'lists distinct folder sessions with paused and %s state and a working switch',
  async (state) => {
    const service = DebuggerService.instance
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
    first.controller.observe({
      observation: 'current',
      snapshot: debuggerSnapshot({ debug_session_id: 'sample-first' }),
    })
    const secondSnapshot = debuggerSnapshot({
      debug_session_id: 'sample-second',
      execution: 'running',
      lifecycle: state === 'exited' ? 'terminated' : state === 'detached' ? 'detached' : 'active',
    })
    secondSnapshot.target.process_ownership = state === 'exited' ? 'owned' : 'external'
    second.controller.observe({
      observation: 'current',
      snapshot: secondSnapshot,
    })
    if (state === 'exited') second.controller.session.exitCode = 7
    service.select(first)
    const view = mount(DebuggerView, { global: { stubs: { DebugPanel: true } } })
    try {
      const switcher = view.get('select[aria-label="Select a debug session"]')
      const options = switcher.findAll('option')
      expect(options).toHaveLength(2)
      expect(options[0].text()).toContain('Paused')
      expect((switcher.element as HTMLSelectElement).value).toBe('sample-first')
      expect(options[1].text()).toContain(
        state === 'exited' ? 'Ended with code 7' : state === 'detached' ? 'Detached' : 'Running'
      )
      await switcher.setValue('sample-second')
      await vi.waitFor(() => expect(showSession).toHaveBeenCalledWith(owner, 'sample-second'))
    } finally {
      view.unmount()
    }
  }
)
