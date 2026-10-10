import { afterEach, describe, expect, it, vi } from 'vitest'
import { MobileBackground } from '@/ai/mobileBackground'

afterEach(() => vi.useRealTimers())

function setup(mobile = true) {
  const audio = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), destroy: vi.fn() }
  const runtime = new MobileBackground(audio)
  runtime.configure(mobile, { whileAgents: false, always: false })
  return { runtime, audio }
}

describe('mobile background audio lifetime', () => {
  it('is off by default and never plays on desktop', () => {
    const { runtime, audio } = setup(false)
    runtime.configure(false, { whileAgents: true, always: true })
    const end = runtime.beginTurn()
    expect(audio.start).not.toHaveBeenCalled()
    end()
    runtime.destroy()
  })

  it('covers overlapping turns and stops shortly after the last ends', async () => {
    vi.useFakeTimers()
    const { runtime, audio } = setup()
    runtime.configure(true, { whileAgents: true, always: false })
    const first = runtime.beginTurn()
    const second = runtime.beginTurn()
    expect(audio.start).toHaveBeenCalledTimes(1)
    first()
    await vi.advanceTimersByTimeAsync(3000)
    expect(audio.stop).not.toHaveBeenCalled()
    second()
    await vi.advanceTimersByTimeAsync(1000)
    const third = runtime.beginTurn()
    await vi.advanceTimersByTimeAsync(3000)
    expect(audio.stop).not.toHaveBeenCalled()
    third()
    third() // releasing a turn twice cannot stop another one
    await vi.advanceTimersByTimeAsync(3000)
    expect(audio.stop).toHaveBeenCalledTimes(1)
    runtime.destroy()
  })

  it('always mode starts without a turn; disabling and unloading stop immediately', () => {
    const { runtime, audio } = setup()
    runtime.configure(true, { whileAgents: false, always: true })
    expect(audio.start).toHaveBeenCalledTimes(1)
    runtime.configure(true, { whileAgents: false, always: false })
    expect(audio.stop).toHaveBeenCalledTimes(1)
    runtime.configure(true, { whileAgents: false, always: true })
    runtime.destroy()
    expect(audio.destroy).toHaveBeenCalledTimes(1)
  })

  it('retries a rejected autoplay on a user gesture, without unhandled rejection', async () => {
    const { runtime, audio } = setup()
    audio.start.mockRejectedValueOnce(new Error('NotAllowedError'))
    runtime.configure(true, { whileAgents: false, always: true })
    await Promise.resolve()
    await Promise.resolve()
    runtime.activate()
    expect(audio.start).toHaveBeenCalledTimes(2)
    runtime.destroy()
  })
})
