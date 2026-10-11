import { expect, it, vi } from 'vitest'
import { nodeDebuggerSupported } from '@/node/providers'
import { DebuggerService } from '@/debugger/DebuggerService'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { MemoryClientStore } from '@abele/node-client'
import { ref, nextTick } from 'vue'
import type { NodeConnection } from '@/node/NodeService'
it.each(['supported', 'unsupported', 'unverified', undefined])(
  'requires the node-level debugger_v1 capability (%s)',
  (status) => {
    const description = {
      capabilities: {
        provider: 'node',
        capabilities: status
          ? {
              debugger_v1:
                status === 'supported'
                  ? { status, evidence: 'sample-contract' }
                  : { status, reason: 'sample unavailable' },
            }
          : {},
      },
      providers: [
        {
          provider: 'fake',
          capabilities: { debugger_v1: { status: 'supported', evidence: 'sample-provider-only' } },
        },
      ],
    }
    expect(nodeDebuggerSupported(description)).toBe(status === 'supported')
  }
)
it('does not promote malformed capability evidence or a provider-only declaration', () => {
  expect(
    nodeDebuggerSupported({
      capabilities: { capabilities: { debugger_v1: { status: 'supported', evidence: false } } },
    })
  ).toBe(false)
  expect(
    nodeDebuggerSupported({
      providers: [
        { capabilities: { debugger_v1: { status: 'supported', evidence: 'sample-contract' } } },
      ],
    })
  ).toBe(false)
})
it('drops advertised availability offline and refreshes it on reconnect', async () => {
  const describe = vi.fn(async () => ({
    capabilities: {
      provider: 'node',
      capabilities: { debugger_v1: { status: 'supported', evidence: 'sample-contract' } },
    },
  }))
  const connection = {
    state: ref('connected'),
    connect: async () => {},
    client: {
      target: { expected_node_id: 'sample-node' },
      onEvent: () => () => {},
      store: new MemoryClientStore(),
      subscribe: async () => {},
      describe,
    },
  } as unknown as NodeConnection
  const presenter = new NodeChatPresenter(
    {
      kind: 'node-session',
      registrationId: 'sample-registration',
      sessionId: 'sample-chat',
      nodeId: 'sample-node',
      title: 'Sample session',
    },
    connection
  )
  try {
    await presenter.load()
    expect(presenter.debuggerAvailable.value).toBe(true)
    connection.state.value = 'offline'
    await nextTick()
    expect(presenter.debuggerAvailable.value).toBe(false)
    describe.mockResolvedValue({ capabilities: { provider: 'node', capabilities: {} } } as never)
    connection.state.value = 'connected'
    await nextTick()
    await vi.waitFor(() => expect(describe).toHaveBeenCalledTimes(2))
    expect(presenter.debuggerAvailable.value).toBe(false)
  } finally {
    presenter.destroy()
  }
})
it('does not call debugger.v1.sessions when a fresh description has the gate off', async () => {
  const request = vi.fn(),
    connect = vi.fn(async () => {})
  const presenter = {
    connection: {
      connect,
      client: { describe: async () => ({ capabilities: { capabilities: {} } }), request },
    },
    reference: { sessionId: 'sample-chat' },
  } as never
  await expect(DebuggerService.instance.sessions(presenter)).rejects.toThrow('does not advertise')
  expect(connect).toHaveBeenCalledOnce()
  expect(request).not.toHaveBeenCalled()
})
