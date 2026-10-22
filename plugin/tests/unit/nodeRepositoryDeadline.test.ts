import { afterEach, expect, it, vi } from 'vitest'
import { RequestChannel, RecordQueue } from '@abele/channel-client'
import { FrameCodec, type AuthenticatedChannel } from '@abele/channel-protocol'

afterEach(() => vi.useRealTimers())

it('lets repository reads and commits finish beyond the ordinary five-second deadline', async () => {
  vi.useFakeTimers()
  const queue = new RecordQueue()
  const transport = {
    receive: () => queue,
    send: vi.fn(async (_bytes: Uint8Array) => {}),
    close: vi.fn(async () => queue.end()),
  }
  const channel = new RequestChannel({ transport } as AuthenticatedChannel)
  channel.start()
  const read = channel.request('repository.v1.diff', {}).catch((error: unknown) => error)
  const commit = channel
    .request('repository.v1.git.commit', {}, 'sample-commit')
    .catch((error: unknown) => error)
  try {
    await vi.advanceTimersByTimeAsync(6000)
    expect(transport.close).not.toHaveBeenCalled()
    const requests = transport.send.mock.calls
      .map(([bytes]) => FrameCodec.decode(bytes))
      .filter((frame) => frame.kind === 'request')
    expect(requests).toHaveLength(2)
    for (const request of requests)
      queue.push(
        FrameCodec.encode({
          kind: 'response',
          request_id: request.request_id,
          result: { completed: true },
        })
      )
    await expect(read).resolves.toEqual({ completed: true })
    await expect(commit).resolves.toEqual({ completed: true })
    let settled = false
    const late = channel
      .request('repository.v1.diff', {})
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true
      })
    await vi.advanceTimersByTimeAsync(29999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await late).toMatchObject({ code: 'outcome_unknown' })
    expect(transport.close).not.toHaveBeenCalled()
    expect(
      transport.send.mock.calls.filter(([bytes]) => FrameCodec.decode(bytes).kind === 'request')
    ).toHaveLength(3)
  } finally {
    await channel.close()
  }
})
