import { afterEach, expect, it, vi } from 'vitest'
import { SilentBackgroundAudio, silentWaveDataUri } from '@/ai/mobileBackgroundAudio'

const restore = Object.getOwnPropertyDescriptor(navigator, 'audioSession')
afterEach(() => {
  vi.unstubAllGlobals()
  if (restore) Object.defineProperty(navigator, 'audioSession', restore)
  else Reflect.deleteProperty(navigator, 'audioSession')
})
function setup(session?: { type: string }) {
  Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true })
  const element = {
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    load: vi.fn(),
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    loop: false,
    muted: true,
    volume: 0,
  }
  const construct = vi.fn(function () {
    return element
  })
  vi.stubGlobal('Audio', construct)
  return { element, construct, audio: new SilentBackgroundAudio() }
}

it('generates a small valid mono PCM wave of silence without a binary asset', () => {
  const encoded = silentWaveDataUri().split(',')[1]
  const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  const view = new DataView(bytes.buffer)
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
  expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE')
  expect(view.getUint16(22, true)).toBe(1)
  expect(view.getUint32(24, true)).toBe(8000)
  expect(view.getUint16(34, true)).toBe(8)
  expect([...bytes.slice(44)].every((value) => value === 128)).toBe(true)
})

it('plays unmuted silent samples in an ambient session and restores what it borrowed', async () => {
  const session = { type: 'auto' }
  const { element, audio } = setup(session)
  await audio.start()
  expect(session.type).toBe('ambient')
  expect(element.loop).toBe(true)
  expect(element.muted).toBe(false)
  expect(element.volume).toBe(1)
  audio.stop()
  expect(element.pause).toHaveBeenCalledOnce()
  expect(session.type).toBe('auto')
  audio.destroy()
  expect(element.load).toHaveBeenCalledOnce()
})

it('does not activate exclusive automatic playback if mixing cannot be requested', async () => {
  const { element, audio } = setup()
  await expect(audio.start()).rejects.toThrow('mixing')
  expect(element.play).not.toHaveBeenCalled()
  audio.destroy()
})

it('does not overwrite a session changed by another audio feature', async () => {
  const session = { type: 'auto' }
  const { audio } = setup(session)
  await audio.start()
  session.type = 'play-and-record'
  audio.stop()
  expect(session.type).toBe('play-and-record')
  audio.destroy()
})
