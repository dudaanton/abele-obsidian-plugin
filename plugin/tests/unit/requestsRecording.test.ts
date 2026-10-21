import { expect, it, vi } from 'vitest'
import { ref } from 'vue'

const state = vi.hoisted(() => ({ bindings: [] as any[] }))
vi.mock('@/debugger/DebuggerService', () => ({
  DebuggerService: { instance: { projectBindings: () => state.bindings } },
}))
import { recordingOf } from '@/requests/RequestsService'

it('selects the recording at the request destination rather than the displayed session', () => {
  state.bindings = [
    ['sample-receiver', 4568],
    ['sample-server', 4567],
  ].map(([name, port]) => ({
    revision: ref(0),
    sessionId: name,
    controller: {
      snapshot: { target: { launch_configuration_id: name } },
      session: { output: `Listening http://localhost:${port}` },
    },
    trace: { status: { recording: { run_id: 'sample-run' } } },
  }))
  const context = { registrationId: 'sample-node', projectId: 'sample-project' }
  expect(recordingOf(context, 'http://127.0.0.1:4567/items')?.sessionId).toBe('sample-server')
  expect(recordingOf(context, 'http://localhost:4568/events')?.sessionId).toBe('sample-receiver')
  expect(recordingOf(context, 'http://localhost:9999/items')).toBeUndefined()
  state.bindings.push(state.bindings[1])
  expect(recordingOf(context, 'http://localhost:4567/items')).toBeUndefined()
  state.bindings = [state.bindings[1]]
  state.bindings[0].controller.session.output = ''
  expect(recordingOf(context, 'http://localhost:4567/items')?.sessionId).toBe('sample-server')
})
