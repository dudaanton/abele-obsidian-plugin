import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { ref } from 'vue'
import { debuggerSnapshot } from '../fixtures/debugger'
vi.mock('@/node/nodePathNavigation', () => ({
  openNodePathTab: vi.fn(async () => {}),
  closeNodePathDrawers: vi.fn(),
}))
import { openNodePathTab } from '@/node/nodePathNavigation'

vi.mock('@/views/revealSidebarView', () => ({ revealSidebarView: vi.fn(async () => {}) }))
import { revealSidebarView } from '@/views/revealSidebarView'
import { DEBUG_VIEW_TYPE, openNodeDebugger } from '@/debugger/register'

afterEach(() => DebuggerService.instance.destroy())

describe('showing a debug session', () => {
  it.each(['src/caller.ts', '/sample/project/src/caller.ts'])(
    'opens a newly mapped caller frame at %s and clears its earlier unavailable-source message',
    async (file) => {
      vi.mocked(openNodePathTab).mockClear()
      const service = DebuggerService.instance
      const target = {
        nodeId: 'sample-node',
        registrationId: 'sample-registration',
        projectId: 'sample-project',
        kind: 'workspace' as const,
        id: 'sample-workspace',
        location: { root: '/sample/project', path: '/sample/project', kind: 'folder' as const },
      }
      const binding = service.binding(
        {
          kind: 'folder-debug',
          target,
          connection: { state: ref('connected'), client: {} },
        } as never,
        'sample-debug'
      )
      binding.controller.observe({ observation: 'current', snapshot: debuggerSnapshot() })
      service.reveal(binding, file, 12)
      binding.controller.registerSource('sample-caller', file)
      binding.controller.session.frames = [{ name: 'caller', file, line: 12 }]
      const workspace = {}
      ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = { workspace }
      service.reveal(binding, file, 12)
      await vi.waitFor(() =>
        expect(openNodePathTab).toHaveBeenCalledWith(
          workspace,
          expect.objectContaining({
            path: 'src/caller.ts',
            debug: expect.objectContaining({ sourceId: 'sample-caller', line: 12 }),
          }),
          false
        )
      )
      expect(binding.controller.error).toBe('')
      expect(binding.controller.session.frames[0].file).toBe('src/caller.ts')
    }
  )
  it('carries the requested line when a source tab must be opened', async () => {
    const service = DebuggerService.instance
    const binding = service.binding({
      reference: { registrationId: 'sample-registration', sessionId: 'sample-chat' },
      connection: { state: ref('connected'), client: {} },
    } as unknown as NodeChatPresenter)
    binding.controller.observe({ observation: 'current', snapshot: debuggerSnapshot() })
    const folder = {
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      projectId: 'sample-project',
      kind: 'workspace' as const,
      id: 'sample-workspace',
    }
    service.registerSource(
      'sample-registration',
      'sample-chat',
      'sample-source',
      'sample.ts',
      'sample-debug',
      'sample-incarnation',
      folder
    )
    const workspace = {}
    ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = { workspace }
    service.reveal(binding, 'sample.ts', 12)
    await vi.waitFor(() =>
      expect(openNodePathTab).toHaveBeenCalledWith(
        workspace,
        expect.objectContaining({
          path: 'sample.ts',
          debug: expect.objectContaining({ line: 12 }),
        }),
        false
      )
    )
  })
  it('opens the Debug panel the way every sidebar panel opens, so a phone’s drawer shows it too', async () => {
    const app = { workspace: {} }
    ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
    const presenter = { reference: { sessionId: 'chat-a' } } as unknown as NodeChatPresenter
    const binding = { open: vi.fn(async () => {}) }
    const order: string[] = []
    binding.open.mockImplementation(async () => {
      order.push('open')
    })
    vi.mocked(revealSidebarView).mockImplementation(async () => {
      order.push('reveal')
    })
    vi.spyOn(DebuggerService.instance, 'sessions').mockResolvedValue([
      { debug_session_id: 'session-1' },
    ] as never)
    vi.spyOn(DebuggerService.instance, 'binding').mockReturnValue(binding as never)
    vi.spyOn(DebuggerService.instance, 'select').mockImplementation(() => {})
    await openNodeDebugger(presenter)
    expect(revealSidebarView).toHaveBeenCalledWith(app, DEBUG_VIEW_TYPE)
    expect(binding.open).toHaveBeenCalledWith('session-1')
    expect(order).toEqual(['open', 'reveal'])
  })
})
