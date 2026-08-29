/**
 * The recording itself: start, pause, resume, stop, and what the waveform is drawn from.
 *
 * Two things are read off the microphone at once. `MediaRecorder` collects the audio that will
 * be sent, and an `AnalyserNode` on the same stream gives the loudness a few times a second —
 * that is the row of bars, and it has to be sampled live because the recorded blob cannot be
 * decoded until it is finished.
 *
 * Everything is taken from the window it was handed. The chat and the settings can both live
 * in a popout, whose `AudioContext`, timers and `navigator` are not the main window's.
 */
import { ref, type Ref } from 'vue'

/**
 * `requesting` is not a formality: the first recording on a machine puts the permission
 * question in front of the person, and until they answer it `getUserMedia` simply does not
 * come back. Without a state of its own the panel sits there looking like nothing happened.
 */
export type RecorderState = 'idle' | 'requesting' | 'recording' | 'paused' | 'recorded'

/** How often the loudness is sampled — 20 bars a second, which reads as movement, not flicker. */
const LEVEL_MS = 50

/** What the recorder is asked for, in the order the engines here actually support them. */
const MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']

export interface Recorder {
  state: Ref<RecorderState>
  /** Loudness from 0 to 1, oldest first, one per `LEVEL_MS`. */
  levels: Ref<number[]>
  /** Milliseconds of audio recorded, not counting time spent paused. */
  elapsed: Ref<number>
  recording: Ref<Blob | null>
  error: Ref<string>
  start(): Promise<void>
  pause(): void
  resume(): void
  stop(): Promise<Blob | null>
  reset(): void
  dispose(): void
}

export function useRecorder(win: Window & typeof window): Recorder {
  const state = ref<RecorderState>('idle')
  const levels = ref<number[]>([])
  const elapsed = ref(0)
  const recording = ref<Blob | null>(null)
  const error = ref('')

  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let context: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let chunks: Blob[] = []
  let ticker: number | null = null
  let startedAt = 0
  let accumulated = 0

  const supportedType = (): string | undefined =>
    MIME_TYPES.find((type) => win.MediaRecorder?.isTypeSupported?.(type))

  /** Root mean square of the current window, which is loudness as an ear would judge it. */
  const sampleLevel = () => {
    if (!analyser) return
    const samples = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(samples)

    let sum = 0
    for (const sample of samples) sum += sample * sample
    const rms = Math.sqrt(sum / samples.length)

    // Speech sits low in the range, so the bars are scaled up and then capped rather than
    // drawn linearly, where an ordinary voice would be a flat line along the bottom.
    levels.value = [...levels.value, Math.min(1, rms * 4)]
    elapsed.value = accumulated + win.performance.now() - startedAt
  }

  const startTicking = () => {
    stopTicking()
    ticker = win.setInterval(sampleLevel, LEVEL_MS)
  }

  const stopTicking = () => {
    if (ticker !== null) win.clearInterval(ticker)
    ticker = null
  }

  const release = () => {
    stopTicking()
    stream?.getTracks().forEach((track) => track.stop())
    stream = null
    recorder = null
    analyser = null
    void context?.close()
    context = null
  }

  const start = async (): Promise<void> => {
    error.value = ''
    state.value = 'requesting'
    try {
      stream = await win.navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      error.value = 'No microphone. Obsidian needs permission to use it.'
      state.value = 'idle'
      return
    }

    context = new win.AudioContext()
    analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)

    const mimeType = supportedType()
    recorder = new win.MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunks = []
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size) chunks.push(event.data)
    }
    recorder.start()

    levels.value = []
    elapsed.value = 0
    accumulated = 0
    startedAt = win.performance.now()
    state.value = 'recording'
    startTicking()
  }

  const pause = () => {
    if (state.value !== 'recording') return

    recorder?.pause()
    stopTicking()
    accumulated += win.performance.now() - startedAt
    elapsed.value = accumulated
    state.value = 'paused'
  }

  const resume = () => {
    if (state.value !== 'paused') return

    recorder?.resume()
    startedAt = win.performance.now()
    state.value = 'recording'
    startTicking()
  }

  const stop = async (): Promise<Blob | null> => {
    if (state.value !== 'recording' && state.value !== 'paused') return recording.value
    if (state.value === 'recording') accumulated += win.performance.now() - startedAt
    elapsed.value = accumulated

    const current = recorder
    const finished = new Promise<void>((resolve) => {
      if (!current) return resolve()
      current.onstop = () => resolve()
    })
    current?.stop()
    await finished

    recording.value = new Blob(chunks, { type: current?.mimeType || 'audio/webm' })
    state.value = 'recorded'
    release()

    return recording.value
  }

  const reset = () => {
    release()
    chunks = []
    levels.value = []
    elapsed.value = 0
    accumulated = 0
    recording.value = null
    error.value = ''
    state.value = 'idle'
  }

  return {
    state,
    levels,
    elapsed,
    recording,
    error,
    start,
    pause,
    resume,
    stop,
    reset,
    dispose: release,
  }
}
