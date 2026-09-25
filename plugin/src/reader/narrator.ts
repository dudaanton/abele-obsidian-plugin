/**
 * Reading a book aloud with the platform's own speech (`speechSynthesis`), the voices the device
 * has — on an iPhone, the ones in its Spoken Content settings.
 *
 * It speaks one sentence at a time: the next is asked for when the last one ends, which is what
 * lets the reader mark the sentence being read and turn the page under it, and what keeps each
 * utterance short (some engines stop reporting the end of a long one). When the part on screen
 * runs out it asks for the next — the next chapter, the next page — and goes on, to the end of
 * the book. Pause and resume are the platform's; a skip starts the next or last sentence.
 */

export interface SpokenSentence {
  text: string
  range: Range
}

export interface NarratorPart {
  /** The part of the book the sentences are in: a chapter, a PDF page. */
  index: number
  sentences: SpokenSentence[]
}

/** What the narrator needs of the book: its sentences, and a way to show the one being read. */
export interface NarratorHost {
  /** The sentences of the part on screen, from the place being read, or from `from`. */
  here(from?: Range | null): Promise<NarratorPart | null>
  /** The next part after `index`, gone to; null at the end of the book. */
  after(index: number): Promise<NarratorPart | null>
  /** The sentence being read, marked and brought into view; null clears the mark. */
  show(sentence: SpokenSentence | null, index: number): void
  lang(): string
  /** The state changed: playing, paused, idle. */
  changed(state: NarratorState): void
}

export type NarratorState = 'idle' | 'playing' | 'paused'

/** The parts of the platform's speech the narrator uses, so a test can stand in for it. */
export interface SpeechLike {
  speak(u: SpeechSynthesisUtterance): void
  cancel(): void
  pause(): void
  resume(): void
  getVoices(): SpeechSynthesisVoice[]
}

export interface NarratorOptions {
  /** A voice's `voiceURI`; empty for the device's own voice for the book's language. */
  voice: string
  rate: number
}

/** The voice to read in: the one chosen, if this device has it; else one for the language. */
export function pickVoice(
  voices: SpeechSynthesisVoice[],
  chosen: string,
  lang: string
): SpeechSynthesisVoice | null {
  const exact = chosen ? voices.find((v) => v.voiceURI === chosen) : null
  if (exact) return exact
  const base = (lang || '').toLowerCase().split(/[-_]/)[0]
  if (!base) return voices.find((v) => v.default) ?? null
  const matching = voices.filter((v) => v.lang.toLowerCase().split(/[-_]/)[0] === base)
  return (
    matching.find((v) => v.default) ??
    matching.find((v) => v.localService) ??
    matching[0] ??
    voices.find((v) => v.default) ??
    null
  )
}

export class Narrator {
  state: NarratorState = 'idle'
  #part: NarratorPart | null = null
  #at = 0
  /** Moves on every start, stop and skip: an utterance of an older one that ends is ignored. */
  #turn = 0

  constructor(
    private readonly host: NarratorHost,
    private readonly speech: SpeechLike,
    private readonly options: () => NarratorOptions,
    private readonly makeUtterance: (text: string) => SpeechSynthesisUtterance
  ) {}

  #set(state: NarratorState): void {
    if (this.state === state) return
    this.state = state
    this.host.changed(state)
  }

  /** Starts reading from the place on screen, or from `from`. */
  async play(from?: Range | null): Promise<void> {
    this.#stopSpeech()
    const part = await this.host.here(from)
    if (!part) return this.stop()
    this.#part = part
    this.#at = 0
    this.#set('playing')
    await this.#speak()
  }

  pause(): void {
    if (this.state !== 'playing') return
    this.speech.pause()
    this.#set('paused')
  }

  resume(): void {
    if (this.state !== 'paused') return
    this.speech.resume()
    this.#set('playing')
  }

  toggle(): void {
    if (this.state === 'playing') this.pause()
    else if (this.state === 'paused') this.resume()
    else void this.play()
  }

  /** The next or the last sentence, now. */
  async skip(by: 1 | -1): Promise<void> {
    if (!this.#part) return
    this.#stopSpeech()
    this.#at = Math.max(0, this.#at + by)
    this.#set('playing')
    await this.#speak()
  }

  stop(): void {
    this.#stopSpeech()
    this.#part = null
    this.host.show(null, -1)
    this.#set('idle')
  }

  #stopSpeech(): void {
    this.#turn++
    this.speech.cancel()
  }

  async #speak(): Promise<void> {
    const turn = this.#turn
    let part = this.#part
    // The part ran out: on to the next one with anything in it, to the end of the book.
    while (part && this.#at >= part.sentences.length) {
      part = await this.host.after(part.index)
      if (turn !== this.#turn) return
      this.#part = part
      this.#at = 0
    }
    if (!part) return this.stop()
    const sentence = part.sentences[this.#at]
    this.host.show(sentence, part.index)
    const { voice, rate } = this.options()
    const u = this.makeUtterance(sentence.text)
    const lang = this.host.lang()
    const picked = pickVoice(this.speech.getVoices(), voice, lang)
    if (picked) u.voice = picked
    if (lang) u.lang = picked?.lang ?? lang
    u.rate = rate
    u.onend = () => {
      if (turn !== this.#turn) return
      this.#at++
      void this.#speak()
    }
    u.onerror = (e) => {
      if (turn !== this.#turn) return
      // A sentence cut off by a cancel is not a failure; anything else skips the sentence.
      const error = e.error
      if (error === 'interrupted' || error === 'canceled') return
      console.warn('[Abele] a sentence could not be read aloud', error)
      this.#at++
      void this.#speak()
    }
    this.speech.speak(u)
    // A pause asked for before this sentence began holds it too.
    if (this.state === 'paused') this.speech.pause()
  }
}
