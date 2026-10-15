import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService } from '@/debugger/DebuggerService'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'

vi.mock('@/views/revealSidebarView', () => ({ revealSidebarView: vi.fn(async () => {}) }))
import { revealSidebarView } from '@/views/revealSidebarView'
import { DEBUG_VIEW_TYPE, openNodeDebugger } from '@/debugger/register'

afterEach(() => DebuggerService.instance.destroy())

describe('showing a debug session', () => {
  it('opens the Debug panel the way every sidebar panel opens, so a phone’s drawer shows it too', async () => {
    const app = { workspace: {} }
    ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
    const presenter = { reference: { sessionId: 'chat-a' } } as unknown as NodeChatPresenter
    const binding = { open: vi.fn(async () => {}) }
    vi.spyOn(DebuggerService.instance, 'sessions').mockResolvedValue([
      { debug_session_id: 'session-1' },
    ] as never)
    vi.spyOn(DebuggerService.instance, 'binding').mockReturnValue(binding as never)
    vi.spyOn(DebuggerService.instance, 'select').mockImplementation(() => {})
    await openNodeDebugger(presenter)
    expect(revealSidebarView).toHaveBeenCalledWith(app, DEBUG_VIEW_TYPE)
    expect(binding.open).toHaveBeenCalledWith('session-1')
  })
})
