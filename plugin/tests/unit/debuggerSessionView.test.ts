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
    const rows = view.findAll('.abele-tree-item')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Paused')
    expect(rows[0].classes()).toContain('abele-tree-item_active')
    expect(rows[1].text()).toContain('Running')
    await rows[1].get('.tree-item-self').trigger('click')
    await vi.waitFor(() => expect(showSession).toHaveBeenCalledWith(owner, 'sample-second'))
  } finally {
    view.unmount()
  }
})
