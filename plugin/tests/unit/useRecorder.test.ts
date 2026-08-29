/**
 * The recorder as a state machine.
 *
 * The engines it drives belong to the browser, so what is asserted here is everything around
 * them: that pausing stops the clock rather than only the recorder, that the microphone is
 * actually let go of afterwards — a stream left running is a recording light that never goes
 * out — and that a refused microphone leaves the thing usable rather than half started.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useRecorder } from '@/audio/useRecorder'

class FakeRecorder {
  static isTypeSupported = (type: string) => type === 'audio/webm;codecs=opus'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state = 'inactive'
  constructor(
    public stream: unknown,
    public options?: { mimeType?: string }
  ) {}
  get mimeType() {
    return this.options?.mimeType ?? ''
  }
  start() {
    this.state = 'recording'
  }
  pause() {
    this.state = 'paused'
  }
  resume() {
    this.state = 'recording'
  }
  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['audio']) })
    this.onstop?.()
  }
}

const track = () => ({ stop: vi.fn() })

function fakeWindow(over: { getUserMedia?: () => Promise<unknown> } = {}) {
  let now = 0
  const tracks = [track()]
  const analyser = {
    fftSize: 0,
    getFloatTimeDomainData: (out: Float32Array) => out.fill(0.25),
  }

  return {
    tracks,
    tick: (ms: number) => {
      now += ms
    },
    /** Runs whatever the recorder scheduled, as many times as the clock allows. */
    fire: () => intervals.forEach((fn) => fn()),
    win: {
      performance: { now: () => now },
      setInterval: (fn: () => void) => {
        intervals.push(fn)
        return intervals.length
      },
      clearInterval: (id: number) => {
        intervals.splice(id - 1, 1, () => {})
      },
      navigator: {
        mediaDevices: {
          getUserMedia: over.getUserMedia ?? (() => Promise.resolve({ getTracks: () => tracks })),
        },
      },
      MediaRecorder: FakeRecorder,
      AudioContext: class {
        createAnalyser = () => analyser
        createMediaStreamSource = () => ({ connect: () => {} })
        close = () => Promise.resolve()
      },
    } as unknown as Window & typeof globalThis,
  }
}

let intervals: (() => void)[] = []

beforeEach(() => {
  intervals = []
})

describe('starting', () => {
  it('is recording, and collecting the loudness for the waveform', async () => {
    const { win, fire } = fakeWindow()
    const recorder = useRecorder(win)

    await recorder.start()
    fire()
    fire()

    expect(recorder.state.value).toBe('recording')
    expect(recorder.levels.value).toHaveLength(2)
    expect(recorder.levels.value[0]).toBeCloseTo(1, 5)
  })

  it('asks for a format the engine actually supports', async () => {
    const { win } = fakeWindow()
    const recorder = useRecorder(win)

    await recorder.start()
    await recorder.stop()

    expect(recorder.recording.value?.type).toBe('audio/webm;codecs=opus')
  })

  /**
   * The first recording on a machine puts the permission question in front of the person, and
   * `getUserMedia` does not return until they answer — which on this machine took forever and
   * looked, from the panel, exactly like nothing happening.
   */
  it('says it is waiting while the permission question is on screen', async () => {
    let answer = (_: unknown) => {}
    const { win } = fakeWindow({ getUserMedia: () => new Promise((resolve) => (answer = resolve)) })
    const recorder = useRecorder(win)

    const starting = recorder.start()
    expect(recorder.state.value).toBe('requesting')

    answer({ getTracks: () => [track()] })
    await starting
    expect(recorder.state.value).toBe('recording')
  })

  it('says so plainly when the microphone is refused', async () => {
    const { win } = fakeWindow({ getUserMedia: () => Promise.reject(new Error('denied')) })
    const recorder = useRecorder(win)

    await recorder.start()

    expect(recorder.state.value).toBe('idle')
    expect(recorder.error.value).toMatch(/microphone/i)
  })
})

describe('pausing', () => {
  it('stops the clock rather than letting it run through the pause', async () => {
    const { win, tick, fire } = fakeWindow()
    const recorder = useRecorder(win)

    await recorder.start()
    tick(1000)
    fire()
    recorder.pause()
    tick(5000)
    recorder.resume()
    tick(500)
    fire()

    expect(recorder.elapsed.value).toBeCloseTo(1500, -1)
  })

  it('collects no bars while it is paused', async () => {
    const { win, fire } = fakeWindow()
    const recorder = useRecorder(win)

    await recorder.start()
    fire()
    recorder.pause()
    fire()
    fire()

    expect(recorder.levels.value).toHaveLength(1)
  })

  it('ignores a resume nobody paused', async () => {
    const { win } = fakeWindow()
    const recorder = useRecorder(win)

    await recorder.start()
    recorder.resume()

    expect(recorder.state.value).toBe('recording')
  })
})

describe('stopping', () => {
  it('hands back what was recorded', async () => {
    const { win } = fakeWindow()
    const recorder = useRecorder(win)

    await recorder.start()
    const blob = await recorder.stop()

    expect(blob).toBeTruthy()
    expect(recorder.state.value).toBe('recorded')
    expect(recorder.recording.value).toBe(blob)
  })

  /** A microphone left open is a recording indicator that never goes out. */
  it('lets go of the microphone', async () => {
    const { win, tracks } = fakeWindow()
    const recorder = useRecorder(win)

    await recorder.start()
    await recorder.stop()

    expect(tracks[0].stop).toHaveBeenCalled()
  })

  it('works from paused as well as from recording', async () => {
    const { win } = fakeWindow()
    const recorder = useRecorder(win)

    await recorder.start()
    recorder.pause()

    await expect(recorder.stop()).resolves.toBeTruthy()
  })

  it('has nothing to hand back when nothing was recorded', async () => {
    const { win } = fakeWindow()
    const recorder = useRecorder(win)

    await expect(recorder.stop()).resolves.toBeNull()
  })
})

describe('starting over', () => {
  it('forgets the recording, the bars and the clock', async () => {
    const { win, fire } = fakeWindow()
    const recorder = useRecorder(win)

    await recorder.start()
    fire()
    await recorder.stop()
    recorder.reset()

    expect(recorder.state.value).toBe('idle')
    expect(recorder.recording.value).toBeNull()
    expect(recorder.levels.value).toEqual([])
    expect(recorder.elapsed.value).toBe(0)
  })

  it('lets go of the microphone when the screen goes away mid-recording', async () => {
    const { win, tracks } = fakeWindow()
    const recorder = useRecorder(win)

    await recorder.start()
    recorder.dispose()

    expect(tracks[0].stop).toHaveBeenCalled()
  })
})
