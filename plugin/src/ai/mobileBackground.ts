export interface BackgroundAudioPort {
  start(): Promise<void>
  stop(): void
  destroy(): void
}

export interface BackgroundSettings {
  whileAgents: boolean
  always: boolean
}

/** The turn lifetime is independent of tabs, views and the host application's API. */
export class MobileBackground {
  private mobile = false
  private settings: BackgroundSettings = { whileAgents: false, always: false }
  private turns = 0
  private playing = false
  private stopTimer: number | null = null
  private audio: BackgroundAudioPort | null

  constructor(audio: BackgroundAudioPort | null = null) {
    this.audio = audio
  }

  install(audio: BackgroundAudioPort): void {
    this.audio?.destroy()
    this.audio = audio
    this.playing = false
    this.update()
  }

  configure(mobile: boolean, settings: BackgroundSettings): void {
    this.mobile = mobile
    this.settings = settings
    this.update()
  }

  beginTurn(): () => void {
    this.turns++
    this.update()
    let ended = false
    return () => {
      if (ended) return
      ended = true
      this.turns--
      this.update(true)
    }
  }

  /** A real input gesture can admit playback that startup autoplay could not. */
  activate(): void {
    this.update()
  }

  private update(grace = false): void {
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer)
    this.stopTimer = null
    const wanted =
      this.mobile && (this.settings.always || (this.settings.whileAgents && this.turns > 0))
    if (wanted) {
      if (this.playing || !this.audio) return
      this.playing = true
      void this.audio.start().catch(() => {
        this.playing = false
      })
    } else if (this.playing) {
      if (grace) this.stopTimer = window.setTimeout(() => this.stop(), 2000)
      else this.stop()
    }
  }

  private stop(): void {
    this.stopTimer = null
    this.playing = false
    this.audio?.stop()
  }

  destroy(): void {
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer)
    this.stopTimer = null
    this.mobile = false
    this.settings = { whileAgents: false, always: false }
    this.playing = false
    this.audio?.destroy()
    this.audio = null
  }
}

export const mobileBackground = new MobileBackground()
