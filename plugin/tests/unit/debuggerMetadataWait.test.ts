import { expect, it, vi } from 'vitest'
import { waitForDebuggerMetadata } from '@/debugger/metadataWait'
import { debuggerSnapshot } from '../fixtures/debugger'
it('accepts additive stop-detail events without requiring a new SDK event union', async () => {
  const snapshot = debuggerSnapshot()
  snapshot.threads[0].stop!.description = 'SampleError: Missing sample item'
  const request = vi.fn(async () => ({
    wait_id: 'sample-wait',
    reason: 'event',
    elapsed_ms: 1,
    snapshot,
    event: { kind: 'stop_details', stop_epoch: snapshot.stop_epoch },
  }))
  const result = await waitForDebuggerMetadata(
    { request },
    {
      debug_session_id: snapshot.debug_session_id,
      incarnation: snapshot.incarnation,
      after_event_seq: 0,
      wait_id: 'sample-wait',
      kinds: ['stopped'],
      timeout_ms: 1000,
    }
  )
  expect(request.mock.calls[0][1].kinds).toContain('stop_details')
  expect(result.snapshot?.threads[0].stop?.description).toContain('SampleError')
})
