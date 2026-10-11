import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { DebuggerGrantSchema } from '@abele/node-protocol'
import { DebuggerBinding } from '@/debugger/DebuggerService'
import { debuggerSnapshot, debuggerStatus } from '../fixtures/debugger'
import type { NodeConnection } from '@/node/NodeService'
function liveGrant(patch = {}) {
  return DebuggerGrantSchema.parse({
    grant_id: 'sample-grant',
    installation_id: 'sample-installation',
    run_id: 'sample-run',
    task_id: 'sample-task',
    conversation_id: 'sample-chat',
    workspace_id: null,
    target_id: 'sample-target',
    debug_session_id: 'sample-debug',
    incarnation: 'sample-incarnation',
    expires_at: new Date(Date.now() + 60000).toISOString(),
    actions: ['read', 'step'],
    mode: 'allow-all',
    revoked: false,
    owner_authority: { installation_id: 'sample-owner', profile: 'local-token-v1' },
    controller_authority: { installation_id: 'sample-installation', profile: 'local-token-v1' },
    ...patch,
  })
}
it('drops a late grant reader response from a previously opened session', async () => {
  let resolve!: (value: unknown) => void
  const read = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    .mockResolvedValueOnce(
      liveGrant({
        debug_session_id: 'sample-other-debug',
        target_id: 'sample-other-target',
        grant_id: 'sample-other-grant',
        mode: 'ask',
      })
    )
  const state = (id: string) =>
    debuggerStatus({
      debug_session_id: id,
      lifecycle: 'terminated',
      target: {
        ...debuggerSnapshot().target,
        target_id: id === 'sample-debug' ? 'sample-target' : 'sample-other-target',
      },
    })
  const connection = {
    state: ref('connected'),
    client: {
      debugger: {
        status: async (id: string) => state(id),
        current: (id: string) => ({ observation: 'current', snapshot: state(id).snapshot }),
        liveGrant: read,
      },
    },
  } as unknown as NodeConnection
  const binding = new DebuggerBinding(connection, 'sample-chat', 'sample-registration')
  vi.spyOn(binding, 'refresh').mockResolvedValue(undefined)
  try {
    const old = binding.open('sample-debug')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    await binding.open('sample-other-debug')
    resolve(liveGrant())
    await old
    expect(binding.controller.session.mode).toBe('ask')
    expect(binding.controller.grantId).toBe('sample-other-grant')
  } finally {
    binding.destroy()
  }
})
it.each([false, true])(
  'loads authoritative mode only through an exposed live-grant client reader (available: %s)',
  async (available) => {
    const read = vi.fn(async () => liveGrant())
    const connection = {
      state: ref('connected'),
      client: {
        debugger: {
          status: async () => debuggerStatus({ lifecycle: 'terminated' }),
          current: () => ({
            observation: 'current',
            snapshot: debuggerSnapshot({ lifecycle: 'terminated' }),
          }),
          ...(available ? { liveGrant: read } : {}),
        },
      },
    } as unknown as NodeConnection
    const binding = new DebuggerBinding(connection, 'sample-chat', 'sample-registration')
    vi.spyOn(binding, 'refresh').mockResolvedValue(undefined)
    try {
      await binding.open('sample-debug')
      expect(binding.controller.session.mode).toBe(available ? 'allow' : 'unknown')
      if (available) expect(read).toHaveBeenCalledWith('sample-debug')
      else {
        expect(read).not.toHaveBeenCalled()
        expect(binding.controller.grantId).toBeUndefined()
        expect(binding.controller.modeUnavailableReason).toContain('does not expose')
      }
    } finally {
      binding.destroy()
    }
  }
)
