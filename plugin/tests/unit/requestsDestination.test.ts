import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ supported: true, bindings: [] as any[], request: vi.fn() }))
vi.mock('@/debugger/DebuggerService', () => ({
  DebuggerService: { instance: { projectBindings: () => state.bindings } },
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      connection: () => ({
        connect: async () => {},
        client: {
          request: state.request,
          describe: async () => ({
            capabilities: {
              capabilities: {
                http_v1: {
                  status: 'supported',
                  destination_owner: state.supported,
                  recording_correlation: true,
                },
              },
            },
          }),
        },
      }),
    }),
  },
}))
import { destinationRecording, RequestsService } from '@/requests/RequestsService'
it('uses the node destination owner even when program output names another address', async () => {
  state.bindings = ['sample-sink', 'sample-server'].map((sessionId) => ({
    sessionId,
    revision: { value: 0 },
    trace: { status: { recording: {} } },
    controller: {
      snapshot: { target: { launch_configuration_id: sessionId } },
      session: { output: '' },
    },
  }))
  state.request.mockResolvedValue({
    reason: 'owned',
    debug_session_id: 'sample-server',
    candidates: ['sample-server'],
  })
  const context = { registrationId: 'sample-node', projectId: 'sample-project' }
  expect(await destinationRecording(context, 'http://localhost:4567/items')).toMatchObject({
    sessionId: 'sample-server',
    routeByDestination: true,
    stepHeader: true,
  })
  expect(state.request).toHaveBeenCalledWith('http.v1.destination', {
    project_id: 'sample-project',
    url: 'http://localhost:4567',
  })
  state.supported = false
  state.request.mockClear()
  expect(await destinationRecording(context, 'http://localhost:4567/items')).toBeUndefined()
  expect(state.request).not.toHaveBeenCalled()
})

it('shares an origin lookup across credentials, paths, queries and fragments', async () => {
  state.supported = true
  state.request.mockClear()
  state.request.mockResolvedValue({ reason: 'ambiguous', debug_session_id: null, candidates: [] })
  RequestsService.destroy()
  const service = RequestsService.instance()
  const context = { registrationId: 'sample-node', projectId: 'sample-project' }
  void service.recording(
    context,
    'https://sample-user:sample-pass@example.test:8443/private?token=sample-token#hidden'
  ).value
  await vi.waitFor(() => expect(state.request).toHaveBeenCalledOnce())
  void service.recording(context, 'https://example.test:8443/other?token=other-token').value
  expect(state.request).toHaveBeenCalledExactlyOnceWith('http.v1.destination', {
    project_id: 'sample-project',
    url: 'https://example.test:8443',
  })
  RequestsService.destroy()
})
it('updates the recording label when the node rejects a provisional owner as ambiguous', async () => {
  state.supported = true
  state.bindings = [
    {
      sessionId: 'sample-server',
      revision: { value: 0 },
      trace: { status: { recording: {} } },
      controller: {
        snapshot: { target: { launch_configuration_id: 'sample-server' } },
        session: { output: '' },
      },
    },
  ]
  state.request.mockResolvedValue({
    reason: 'ambiguous',
    debug_session_id: null,
    candidates: ['sample-server', 'sample-other'],
  })
  RequestsService.destroy()
  const selected = RequestsService.instance().recording(
    { registrationId: 'sample-node', projectId: 'sample-project' },
    'http://localhost:4567/items'
  )
  expect(selected.value?.sessionId).toBe('sample-server')
  await vi.waitFor(() => expect(selected.value).toBeUndefined())
  RequestsService.destroy()
})
