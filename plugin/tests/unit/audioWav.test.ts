/**
 * Turning what the microphone gave us into something a transcriber will take.
 *
 * The recorder hands back whatever the engine felt like producing — `audio/webm;codecs=opus`
 * on the desktop, `audio/mp4` on an iPhone — and OpenRouter accepts neither webm nor anything
 * it has to guess at. WAV it will take from every provider, so the audio is decoded, brought
 * down to one channel at the rate speech recognition actually wants, and re-encoded.
 */
import { describe, it, expect } from 'vitest'
import { downmixToMono, resample, encodeWav, TARGET_SAMPLE_RATE } from '@/audio/wav'

const read = (bytes: Uint8Array, at: number, length: number) =>
  String.fromCharCode(...bytes.slice(at, at + length))

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

describe('bringing two ears down to one', () => {
  it('averages the channels', () => {
    const left = Float32Array.from([1, 0, -1])
    const right = Float32Array.from([0, 0, 1])

    expect([...downmixToMono([left, right])]).toEqual([0.5, 0, 0])
  })

  it('leaves a single channel exactly as it is', () => {
    const only = Float32Array.from([0.25, -0.5])

    expect([...downmixToMono([only])]).toEqual([0.25, -0.5])
  })
})

describe('changing the rate', () => {
  it('shortens the samples in proportion', () => {
    const samples = Float32Array.from({ length: 48_000 }, (_, i) => Math.sin(i / 10))

    expect(resample(samples, 48_000, 16_000).length).toBe(16_000)
  })

  it('gives back the very same samples when the rate already matches', () => {
    const samples = Float32Array.from([0.1, 0.2, 0.3])

    expect(resample(samples, 16_000, 16_000)).toBe(samples)
  })

  /** A tone has to survive the trip: a resampler that drops or repeats samples wanders off. */
  it('keeps a tone at the pitch it was', () => {
    const from = 48_000
    const hz = 440
    const samples = Float32Array.from({ length: from }, (_, i) =>
      Math.sin((2 * Math.PI * hz * i) / from)
    )

    const out = resample(samples, from, TARGET_SAMPLE_RATE)

    // Zero crossings going upwards happen once per cycle, so there is one per hertz per second.
    let crossings = 0
    for (let i = 1; i < out.length; i++) if (out[i - 1] < 0 && out[i] >= 0) crossings++

    expect(crossings).toBeGreaterThan(hz - 5)
    expect(crossings).toBeLessThan(hz + 5)
  })
})

describe('writing a WAV', () => {
  const samples = Float32Array.from([0, 0.5, -0.5, 1, -1])

  it('starts with the header every decoder looks for', () => {
    const wav = encodeWav(samples, TARGET_SAMPLE_RATE)

    expect(read(wav, 0, 4)).toBe('RIFF')
    expect(read(wav, 8, 4)).toBe('WAVE')
    expect(read(wav, 12, 4)).toBe('fmt ')
    expect(read(wav, 36, 4)).toBe('data')
  })

  it('says it is one channel of 16-bit PCM at the rate it was given', () => {
    const wav = view(encodeWav(samples, TARGET_SAMPLE_RATE))

    expect(wav.getUint16(20, true)).toBe(1) // PCM
    expect(wav.getUint16(22, true)).toBe(1) // mono
    expect(wav.getUint32(24, true)).toBe(TARGET_SAMPLE_RATE)
    expect(wav.getUint16(34, true)).toBe(16) // bits per sample
  })

  it('is exactly as long as its header plus two bytes a sample', () => {
    const wav = encodeWav(samples, TARGET_SAMPLE_RATE)

    expect(wav.length).toBe(44 + samples.length * 2)
    expect(view(wav).getUint32(4, true)).toBe(wav.length - 8)
    expect(view(wav).getUint32(40, true)).toBe(samples.length * 2)
  })

  it('writes the samples themselves, at full scale', () => {
    const wav = view(encodeWav(samples, TARGET_SAMPLE_RATE))

    expect(wav.getInt16(44, true)).toBe(0)
    expect(wav.getInt16(46, true)).toBe(16384)
    expect(wav.getInt16(48, true)).toBe(-16384)
    expect(wav.getInt16(50, true)).toBe(32767)
    expect(wav.getInt16(52, true)).toBe(-32768)
  })

  /** A microphone that clipped hands back samples past ±1, and those must not wrap around. */
  it('clamps anything louder than full scale instead of letting it wrap', () => {
    const wav = view(encodeWav(Float32Array.from([2, -2]), TARGET_SAMPLE_RATE))

    expect(wav.getInt16(44, true)).toBe(32767)
    expect(wav.getInt16(46, true)).toBe(-32768)
  })
})
