/**
 * What comes out of the microphone, turned into what a transcriber will accept.
 *
 * `MediaRecorder` produces `audio/webm;codecs=opus` in Chromium and `audio/mp4` on an iPhone.
 * OpenRouter takes wav, mp3, m4a, ogg, flac and the pcm forms — not webm — and which of those
 * a given provider accepts varies. WAV is the one nobody argues about, so everything is
 * decoded and re-encoded as WAV rather than hoping the recorder produced something usable.
 *
 * Mono at 16 kHz because that is what speech recognition works at: a minute of it is under
 * two megabytes before base64, against roughly six for what the recorder hands over.
 */

/** What every speech model is trained on, and small enough to post without thinking about it. */
export const TARGET_SAMPLE_RATE = 16_000

export function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]

  const out = new Float32Array(channels[0].length)
  for (let i = 0; i < out.length; i++) {
    let sum = 0
    for (const channel of channels) sum += channel[i]
    out[i] = sum / channels.length
  }

  return out
}

/**
 * Linear interpolation, which is more than enough going downwards.
 *
 * Dropping from 48 kHz to 16 kHz throws away everything above 8 kHz, and speech carries almost
 * nothing up there — a proper filtered resampler would cost a dependency to remove aliasing a
 * transcriber cannot hear.
 */
export function resample(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return samples

  const ratio = from / to
  const out = new Float32Array(Math.round(samples.length / ratio))

  for (let i = 0; i < out.length; i++) {
    const at = i * ratio
    const low = Math.floor(at)
    const high = Math.min(low + 1, samples.length - 1)
    const fraction = at - low
    out[i] = samples[low] * (1 - fraction) + samples[high] * fraction
  }

  return out
}

const HEADER_BYTES = 44

export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(HEADER_BYTES + samples.length * 2)
  const header = new DataView(bytes.buffer)

  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i)
  }

  ascii(0, 'RIFF')
  header.setUint32(4, bytes.length - 8, true)
  ascii(8, 'WAVE')

  ascii(12, 'fmt ')
  header.setUint32(16, 16, true) // the size of this chunk
  header.setUint16(20, 1, true) // uncompressed PCM
  header.setUint16(22, 1, true) // one channel
  header.setUint32(24, sampleRate, true)
  header.setUint32(28, sampleRate * 2, true) // bytes per second
  header.setUint16(32, 2, true) // bytes per frame
  header.setUint16(34, 16, true) // bits per sample

  ascii(36, 'data')
  header.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) {
    // Clamped, because a clipped microphone hands back samples past full scale and the cast
    // would wrap them round into the opposite sign — a click in the middle of a word.
    const sample = Math.max(-1, Math.min(1, samples[i]))
    header.setInt16(HEADER_BYTES + i * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true)
  }

  return bytes
}

/**
 * A recording as WAV bytes, whatever the engine recorded it as.
 *
 * @param win the window the audio belongs to — settings and the chat can be in a popout, whose
 *   `AudioContext` is not the main window's
 */
export async function toWav(blob: Blob, win: Window & typeof window): Promise<Uint8Array> {
  const context = new win.AudioContext()

  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) =>
      decoded.getChannelData(i)
    )
    const mono = resample(downmixToMono(channels), decoded.sampleRate, TARGET_SAMPLE_RATE)

    return encodeWav(mono, TARGET_SAMPLE_RATE)
  } finally {
    void context.close()
  }
}
