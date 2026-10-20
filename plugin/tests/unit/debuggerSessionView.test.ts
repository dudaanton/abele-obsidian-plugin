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
it('lists distinct folder sessions with visible paused state and a working switch', async () => {
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
  second.controller.observe({
    observation: 'current',
    snapshot: debuggerSnapshot({ debug_session_id: 'sample-second', execution: 'running' }),
  })
  service.select(first)
  const view = mount(DebuggerView, { global: { stubs: { DebugPanel: true } } })
  try {
    const switcher = view.get('select[aria-label="Select a debug session"]')
    const options = switcher.findAll('option')
    expect(options).toHaveLength(2)
    expect(options[0].text()).toContain('Paused')
    expect((switcher.element as HTMLSelectElement).value).toBe('sample-first')
    expect(options[1].text()).toContain('Running')
    await switcher.setValue('sample-second')
    await vi.waitFor(() => expect(showSession).toHaveBeenCalledWith(owner, 'sample-second'))
  } finally {
    view.unmount()
  }
})
