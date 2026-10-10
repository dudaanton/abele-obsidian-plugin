import type { BackgroundAudioPort } from './mobileBackground'

/** PCM silence, not a muted media element: WebKit treats muted playback as dispensable. */
export function silentWaveDataUri(): string {
  const samples = 8000
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8000, true)
  view.setUint32(28, 8000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, samples, true)
  bytes.fill(128, 44)
  return `data:audio/wav;base64,${btoa(String.fromCharCode(...bytes))}`
}

interface WebAudioSession {
  type: string
}

/** Ambient is WebKit's mixing category. Never request exclusive `playback`. */
export class SilentBackgroundAudio implements BackgroundAudioPort {
  private audio: HTMLAudioElement | null = null
  private session: WebAudioSession | undefined
  private previousType: string | undefined

  async start(): Promise<void> {
    if (!this.audio) {
      this.audio = new Audio(silentWaveDataUri())
      this.audio.loop = true
      this.audio.muted = false
      this.audio.volume = 1
      this.audio.setAttribute('playsinline', '')
    }
    this.session = (navigator as Navigator & { audioSession?: WebAudioSession }).audioSession
    if (this.session && this.previousType === undefined) {
      this.previousType = this.session.type
      this.session.type = 'ambient'
    }
    try {
      await this.audio.play()
    } catch (error) {
      this.restoreSession()
      throw error
    }
  }

  stop(): void {
    this.audio?.pause()
    this.restoreSession()
  }

  private restoreSession(): void {
    if (this.session && this.previousType !== undefined && this.session.type === 'ambient')
      this.session.type = this.previousType
    this.previousType = undefined
  }

  destroy(): void {
    this.stop()
    if (this.audio) {
      this.audio.removeAttribute('src')
      this.audio.load()
      this.audio = null
    }
  }
}
