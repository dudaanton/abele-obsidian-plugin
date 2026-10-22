import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestChannel, RecordQueue, BrowserRecordTransport } from '@abele/channel-client'
import { FrameCodec, LIMITS, type AuthenticatedChannel } from '@abele/channel-protocol'
import { MobileBackground, mobileBackground } from '@/ai/mobileBackground'
import { AppSuspension } from '@/ai/appSuspension'
import { SuspendedRequest } from '@/ai/suspendedRequest'
import { withDeadline } from '@/helpers/http'
import { OpenAIClient } from '@/ai/client/OpenAIClient'
import type { ModelConfig, StreamEvent } from '@/ai/client/types'

// The policy belongs to the channel runtime; older bundles ignore it, exposing the regression.
const runtime = RequestChannel as typeof RequestChannel & { backgroundActive: () => boolean }
let active = false
const flush = async () => {
  for (let i = 0; i < 15; i++) await Promise.resolve()
}
beforeEach(() => {
  vi.useFakeTimers()
  active = false
  runtime.backgroundActive = () => active
  runtime.debug = (...args) => console.debug(...args)
})
afterEach(() => {
  runtime.backgroundActive = () => mobileBackground.active
  runtime.debug = (...args) => console.debug(...args)
  mobileBackground.destroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function channel() {
  const queue = new RecordQueue()
  const transport = {
    receive: () => queue,
    send: vi.fn(async (_bytes: Uint8Array) => {}),
    close: vi.fn(async (_reason: string) => queue.end()),
  }
  const requests = new RequestChannel({ transport } as AuthenticatedChannel)
  requests.start()
  return { requests, queue, transport }
}

describe('background connection liveness', () => {
  it('reports only admitted audio playback, including turn grace, and ignores a late old rejection', async () => {
    let reject!: (error: Error) => void
    const audio = {
      start: vi.fn(
        () =>
          new Promise<void>((_, fail) => {
            reject = fail
          })
      ),
      stop: vi.fn(),
      destroy: vi.fn(),
    }
    const bg = new MobileBackground(audio)
    bg.configure(true, { whileAgents: false, always: true })
    expect(bg.active).toBe(false)
    bg.configure(true, { whileAgents: false, always: false })
    audio.start.mockImplementation(async () => {})
    bg.configure(true, { whileAgents: true, always: false })
    const end = bg.beginTurn()
    await flush()
    expect(bg.active).toBe(true)
    reject(new Error('old playback failed'))
    await flush()
    expect(bg.active).toBe(true)
    end()
    expect(bg.active).toBe(true)
    await vi.advanceTimersByTimeAsync(2000)
    expect(bg.active).toBe(false)
    bg.destroy()
  })

  it('does not abandon a quiet model stream solely because the audio-kept host timer was delayed', async () => {
    mobileBackground.install({ start: async () => {}, stop: () => {}, destroy: () => {} })
    mobileBackground.configure(true, { whileAgents: false, always: true })
    await flush()
    const lifecycle = new AppSuspension()
    lifecycle.enabled = true
    const request = new SuspendedRequest(undefined, lifecycle)
    lifecycle.setHidden(true)
    vi.setSystemTime(Date.now() + 40_000)
    lifecycle.heartbeat()
    lifecycle.setHidden(false)
    await vi.advanceTimersByTimeAsync(1500)
    expect(request.controller.signal.aborted).toBe(false)
    request.dispose()
  })

  it('logs a remote heartbeat close with a bounded reason instead of arbitrary peer text', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const socket = {
      close: vi.fn(),
      binaryType: '',
      onclose: (_event: { code: number; wasClean: boolean; reason: string }) => {},
    }
    new BrowserRecordTransport(socket as unknown as WebSocket)
    socket.onclose({ code: 1000, wasClean: true, reason: 'heartbeat_timeout' })
    expect(debug).toHaveBeenCalledWith('[Abele node] socket closed', {
      code: 1000,
      clean: true,
      reason: 'heartbeat_timeout',
    })
    debug.mockClear()
    socket.onclose({ code: 1006, wasClean: false, reason: 'sample private payload' })
    expect(debug).toHaveBeenCalledWith('[Abele node] socket closed', {
      code: 1006,
      clean: false,
      reason: 'peer_close',
    })
  })

  it('probes after a delayed node heartbeat and preserves the channel when a pong arrives', async () => {
    active = true
    const { requests, queue, transport } = channel()
    vi.setSystemTime(Date.now() + LIMITS.dead_ms + 1000)
    await vi.advanceTimersByTimeAsync(LIMITS.heartbeat_ms)
    expect(transport.close).not.toHaveBeenCalled()
    expect(transport.send.mock.calls.map(([bytes]) => FrameCodec.decode(bytes).kind)).toContain(
      'ping'
    )
    queue.push(FrameCodec.encode({ kind: 'pong' }))
    await flush()
    await vi.advanceTimersByTimeAsync(5000)
    expect(transport.close).not.toHaveBeenCalled()
    await requests.close()
  })

  it('reprobes a throttled probe deadline, but closes a genuinely unresponsive peer after a timely probe', async () => {
    active = true
    const { requests, transport } = channel()
    vi.setSystemTime(Date.now() + LIMITS.dead_ms + 1000)
    await vi.advanceTimersByTimeAsync(LIMITS.heartbeat_ms)
    expect(transport.close).not.toHaveBeenCalled()
    const sent = transport.send.mock.calls.length
    vi.setSystemTime(Date.now() + 60_000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(transport.close).not.toHaveBeenCalled()
    expect(transport.send.mock.calls.length).toBeGreaterThan(sent)
    await vi.advanceTimersByTimeAsync(5000)
    expect(transport.close).toHaveBeenCalledWith('heartbeat_probe_timeout')
    await requests.close()
  })

  it('retains immediate heartbeat timeout behavior with background audio off', async () => {
    const { requests, transport } = channel()
    vi.setSystemTime(Date.now() + LIMITS.dead_ms + 1000)
    await vi.advanceTimersByTimeAsync(LIMITS.heartbeat_ms)
    expect(transport.close).toHaveBeenCalled()
    await requests.close()
  })

  it('does not replay a timed-out operation or close a responsive node after a throttled request deadline', async () => {
    active = true
    const { requests, queue, transport } = channel()
    const result = requests.request('session.send', {}, 'sample-operation').catch((error) => error)
    vi.setSystemTime(Date.now() + 60_000)
    await vi.advanceTimersByTimeAsync(5000)
    expect(transport.close).not.toHaveBeenCalled()
    const request = transport.send.mock.calls
      .map(([bytes]) => FrameCodec.decode(bytes))
      .find((frame) => frame.kind === 'request')!
    queue.push(
      FrameCodec.encode({
        kind: 'response',
        request_id: (request as { request_id: string }).request_id,
        result: { accepted: true },
      })
    )
    await flush()
    expect(await result).toEqual({ accepted: true })
    expect(
      transport.send.mock.calls.filter(([bytes]) => FrameCodec.decode(bytes).kind === 'request')
    ).toHaveLength(1)
    await requests.close()
  })

  it('keeps an uncertain operation uncertain but probes rather than disconnecting a responsive node', async () => {
    active = true
    const { requests, queue, transport } = channel()
    const result = requests.request('session.send', {}, 'sample-operation').catch((error) => error)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await result).toMatchObject({ code: 'outcome_unknown' })
    expect(transport.close).not.toHaveBeenCalled()
    queue.push(FrameCodec.encode({ kind: 'pong' }))
    await flush()
    await vi.advanceTimersByTimeAsync(5000)
    expect(transport.close).not.toHaveBeenCalled()
    expect(
      transport.send.mock.calls.filter(([bytes]) => FrameCodec.decode(bytes).kind === 'request')
    ).toHaveLength(1)
    await requests.close()
  })

  it('keeps the connection on a request timeout with audio off and clears probe timers on explicit Stop', async () => {
    const first = channel()
    const failed = first.requests.request('session.send', {}).catch((error) => error)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await failed).toMatchObject({ code: 'outcome_unknown' })
    // Since node 0.4.39 a request deadline leaves liveness to heartbeats; the transport stays open.
    expect(first.transport.close).not.toHaveBeenCalled()
    await first.requests.close()
    active = true
    const second = channel()
    vi.setSystemTime(Date.now() + LIMITS.dead_ms + 1000)
    await vi.advanceTimersByTimeAsync(LIMITS.heartbeat_ms)
    await second.requests.close()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(second.transport.close).toHaveBeenCalledTimes(1)
  })

  it.each(['headers', 'stream'] as const)(
    'preserves the actual model %s transport across a delayed deadline',
    async (phase) => {
      mobileBackground.install({ start: async () => {}, stop: () => {}, destroy: () => {} })
      mobileBackground.configure(true, { whileAgents: false, always: true })
      await flush()
      let complete!: () => void
      const cancel = vi.fn()
      const response = () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              complete = () => {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"choices":[{"delta":{"content":"Sample response"}}]}\n\ndata: [DONE]\n\n'
                  )
                )
                controller.close()
              }
            },
            cancel,
          })
        )
      let headers!: (value: Response) => void
      const fetch = vi.spyOn(window, 'fetch').mockImplementation(() =>
        phase === 'headers'
          ? new Promise<Response>((resolve) => {
              headers = resolve
            })
          : Promise.resolve(response())
      )
      const events: StreamEvent[] = []
      const work = (async () => {
        for await (const event of new OpenAIClient().stream(
          {
            id: 'sample-model',
            baseUrl: 'https://sample.invalid/v1',
            requestTimeoutSeconds: 5,
          } as ModelConfig,
          '',
          [],
          []
        ))
          events.push(event)
      })()
      await flush()
      vi.setSystemTime(Date.now() + 40_000)
      await vi.advanceTimersByTimeAsync(5000)
      if (phase === 'headers') headers(response())
      await flush()
      complete()
      await work
      expect(cancel).not.toHaveBeenCalled()
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(events.at(-1)).toMatchObject({ type: 'done', message: { stopReason: 'stop' } })
    }
  )

  it('gives a throttled model deadline a fresh receive window without removing genuine deadlines', async () => {
    let resolve!: (value: string) => void
    const deadline = withDeadline(
      new Promise<string>((done) => {
        resolve = done
      }),
      5000,
      undefined,
      () => true
    )
    const result = deadline.catch((error) => error)
    vi.setSystemTime(Date.now() + 40_000)
    await vi.advanceTimersByTimeAsync(5000)
    resolve('buffered response')
    expect(await result).toBe('buffered response')
    const timeout = withDeadline(new Promise(() => {}), 5000, undefined, () => true).catch(
      (error) => error
    )
    await vi.advanceTimersByTimeAsync(5000)
    expect(await timeout).toBeInstanceOf(Error)
  })
})
