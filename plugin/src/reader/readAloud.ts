/**
 * Reading aloud in a book tab: the narrator (`narrator.ts`) given this book's pages — the part on
 * screen, the next ones as it goes — and a way to mark the sentence being read and keep it on
 * screen. In a reflowing book the mark is drawn on the engine's overlay and the page turns under
 * it; on pages of a fixed size (a PDF, a comic) it is a box over the page, and the reader goes to
 * the next page as the narrator does.
 */
import { Notice } from 'obsidian'
import { Overlayer } from '@/vendor/foliate-js/overlayer.js'
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import {
  Narrator,
  type NarratorPart,
  type NarratorState,
  type SpeechLike,
  type SpokenSentence,
} from './narrator'
import { sentencesIn } from './sentences'
import { drawBoxes } from './marks'
import { readerTestHooks } from './viewType'

const SPEAKING = 'abele-speaking'

interface Contents {
  doc: Document
  index?: number
  overlayer?: {
    add(key: string, range: Range, draw: unknown, opts: unknown): void
    remove(key: string): void
  }
}

interface Engine extends FoliateView {
  renderer: FoliateView['renderer'] & {
    index?: number
    scrollToAnchor?: (anchor: Range) => Promise<void>
    getContents(): Contents[]
  }
}

/** The platform's speech, or the test tier's stand-in; null where the platform has none. */
function platformSpeech(): {
  speech: SpeechLike
  make: (text: string) => SpeechSynthesisUtterance
} | null {
  const hooked = readerTestHooks.speech
  if (hooked) return hooked
  const speech = activeWindow.speechSynthesis
  const Utterance = (
    activeWindow as unknown as { SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance }
  ).SpeechSynthesisUtterance
  if (!speech || typeof Utterance !== 'function') return null
  return { speech, make: (text) => new Utterance(text) }
}

/** Whether this device can read aloud at all. */
export const canReadAloud = (): boolean => !!platformSpeech()

const langOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return langOf(value[0])
  return ''
}

export class ReadAloud {
  readonly narrator: Narrator | null
  /** The page each loaded document is, as the tab learnt it when the page arrived. */
  private readonly indexOf: (doc: Document) => number | undefined
  private marked: Document | null = null
  /** The part the narrator is reading: the last one handed to it. */
  private part: NarratorPart | null = null

  constructor(
    private readonly engine: Engine,
    indexOf: (doc: Document) => number | undefined,
    private readonly themeEl: HTMLElement,
    options: () => { voice: string; rate: number },
    changed: (state: NarratorState) => void
  ) {
    this.indexOf = indexOf
    const platform = platformSpeech()
    this.narrator = platform
      ? new Narrator(
          {
            here: (from) => this.here(from),
            after: (index) => this.after(index),
            show: (sentence, index) => this.show(sentence, index),
            lang: () => this.lang(),
            changed,
          },
          platform.speech,
          options,
          platform.make
        )
      : null
  }

  private contents(): Contents[] {
    return this.engine.renderer.getContents() as Contents[]
  }

  private docAt(index: number): Document | null {
    for (const c of this.contents())
      if (c.doc && (c.index ?? this.indexOf(c.doc)) === index) return c.doc
    return null
  }

  private lang(): string {
    const meta = langOf(this.engine.book.metadata?.language)
    return meta || this.contents()[0]?.doc?.documentElement.lang || 'en'
  }

  /** The part on screen, its sentences from the place being read — or from `from`. */
  private async here(from?: Range | null): Promise<NarratorPart | null> {
    const index =
      this.engine.renderer.index ??
      this.contents()
        .map((c) => c.index ?? this.indexOf(c.doc))
        .find((i) => i !== undefined)
    if (index === undefined) return null
    const doc = this.docAt(index)
    if (!doc) return null
    const start = from ?? this.engine.lastLocation?.range ?? null
    const sentences = sentencesIn(
      doc,
      this.lang(),
      start?.startContainer.ownerDocument === doc ? start : null
    )
    return sentences.length ? (this.part = { index, sentences }) : this.after(index)
  }

  /** The next part, gone to, once its page — and a PDF page's text — has arrived. */
  private async after(index: number): Promise<NarratorPart | null> {
    const next = index + 1
    if (next >= this.engine.book.sections.length) return null
    await this.engine.goTo(next)
    const deadline = Date.now() + 8000
    let doc: Document | null = null
    while (Date.now() < deadline) {
      doc = this.docAt(next)
      const drawing = doc?.querySelector('.textLayer') && !doc.querySelector('.textLayer span')
      if (doc?.body && !drawing) break
      await new Promise((r) => window.setTimeout(r, 100))
    }
    if (!doc) return null
    return (this.part = { index: next, sentences: sentencesIn(doc, this.lang()) })
  }

  /**
   * The part's sentences found again on its page, when the page has drawn its text anew — a PDF
   * page does when it is zoomed, or when the room around it changes — and the words the ranges
   * pointed at are gone. The part is a run of the page's sentences to its end, so it is matched
   * against the end of the page's, text by text.
   */
  private refresh(part: NarratorPart): void {
    const doc = this.docAt(part.index)
    if (!doc) return
    const fresh = sentencesIn(doc, this.lang())
    const tail = fresh.slice(fresh.length - part.sentences.length)
    if (tail.length !== part.sentences.length) return
    if (tail.some((s, i) => s.text !== part.sentences[i].text)) return
    tail.forEach((s, i) => (part.sentences[i].range = s.range))
  }

  /** The sentence being read, marked, and the page brought to it; null clears the mark. */
  private show(sentence: SpokenSentence | null, index: number): void {
    for (const c of this.contents()) c.overlayer?.remove(SPEAKING)
    if (this.marked?.defaultView) drawBoxes(this.marked, SPEAKING, [])
    this.marked = null
    if (!sentence) return
    // Its words gone from the page: the page itself made again, or its text redrawn — a range
    // whose words are removed stays in the page, shrunk to where they were.
    const bare = (s: string) => s.replace(/\s+/g, '')
    const stale =
      sentence.range.startContainer.ownerDocument !== this.docAt(index) ||
      bare(sentence.range.toString()) !== bare(sentence.text)
    if (stale && this.part?.index === index) this.refresh(this.part)
    const range = sentence.range
    const color =
      getComputedStyle(this.themeEl).getPropertyValue('--text-accent').trim() || 'Highlight'
    const content = this.contents().find((c) => c.doc === range.startContainer.ownerDocument)
    if (content?.overlayer) {
      content.overlayer.add(SPEAKING, range, Overlayer.highlight, { color })
      void this.engine.renderer.scrollToAnchor?.(range)
      return
    }
    // Pages of a fixed size: a box over the words, and the page they are on shown.
    const doc = range.startContainer.ownerDocument
    if (doc) {
      drawBoxes(doc, SPEAKING, [{ range, color }], 0.25)
      this.marked = doc
    }
    if (this.engine.renderer.index !== undefined && this.engine.renderer.index !== index)
      void this.engine.goTo(index)
  }

  toggle(from?: Range | null): void {
    if (!this.narrator) {
      new Notice('Reading aloud is not available on this device.')
      return
    }
    if (from) void this.narrator.play(from)
    else this.narrator.toggle()
  }

  stop(): void {
    this.part = null
    this.narrator?.stop()
  }
}
