/**
 * Reading aloud: a page's sentences (`src/reader/sentences.ts`) and the narrator that speaks them
 * one at a time and goes on through the book (`src/reader/narrator.ts`), against a stand-in for
 * the platform's speech. The platform's own voices are the e2e tier's.
 */
import { describe, it, expect, vi } from 'vitest'
import { sentencesIn } from '@/reader/sentences'
import {
  Narrator,
  pickVoice,
  type NarratorHost,
  type NarratorPart,
  type SpeechLike,
} from '@/reader/narrator'

const page = (html: string) => new DOMParser().parseFromString(html, 'text/html')

describe('the sentences of a page', () => {
  it('are split within each block, never across two, and keep their place on the page', () => {
    const doc = page(
      '<body><h1>Chapter one</h1><p>It was late. The <em>rain</em> had stopped!</p><p>Then silence</p></body>'
    )
    const list = sentencesIn(doc, 'en')
    expect(list.map((s) => s.text)).toEqual([
      'Chapter one',
      'It was late.',
      'The rain had stopped!',
      'Then silence',
    ])
    // Where each sentence sits on the page is checked in the running app: happy-dom's Range
    // does not keep a start and an end in different text nodes.
  })

  it('leave out what is hidden, and what the cleaning took out', () => {
    const doc = page(
      '<body><p>Seen.</p><aside hidden>A note.</aside><span data-abele-removed="script" hidden>x()</span><script>y()</script><p>Also seen.</p></body>'
    )
    expect(sentencesIn(doc, 'en').map((s) => s.text)).toEqual(['Seen.', 'Also seen.'])
  })

  it('start from the sentence a place falls in', () => {
    const doc = page('<body><p>One. Two. Three.</p></body>')
    const text = doc.querySelector('p')!.firstChild!
    const from = doc.createRange()
    from.setStart(text, 6)
    from.collapse(true)
    expect(sentencesIn(doc, 'en', from).map((s) => s.text)).toEqual(['Two.', 'Three.'])
  })

  it('start from the start of a place that spans the page, not its end', () => {
    const doc = page('<body><p>One. Two. Three.</p></body>')
    const text = doc.querySelector('p')!.firstChild!
    // happy-dom collapses a range whose end is set after its start, so the page's range is
    // written out: it starts at "Two." and ends with the text.
    const from = { startContainer: text, startOffset: 5, endContainer: text, endOffset: 16 } as unknown as Range
    expect(sentencesIn(doc, 'en', from).map((s) => s.text)).toEqual(['Two.', 'Three.'])
  })

  it('read a line break as a space, as in a PDF’s text layer', () => {
    const doc = page(
      '<body><div class="textLayer"><span>The end of a</span><br><span>line.</span></div></body>'
    )
    expect(sentencesIn(doc, 'en').map((s) => s.text)).toEqual(['The end of a line.'])
  })
})

describe('the voice', () => {
  const v = (voiceURI: string, lang: string, extra: Partial<SpeechSynthesisVoice> = {}) =>
    ({
      voiceURI,
      lang,
      name: voiceURI,
      default: false,
      localService: true,
      ...extra,
    }) as SpeechSynthesisVoice
  const voices = [
    v('en-A', 'en-US', { default: true }),
    v('ru-M', 'ru-RU'),
    v('ru-K', 'ru-RU', { localService: false }),
  ]

  it('is the one chosen when the device has it, else one for the book’s language', () => {
    expect(pickVoice(voices, 'ru-K', 'en')!.voiceURI).toBe('ru-K')
    expect(pickVoice(voices, 'gone', 'ru')!.voiceURI).toBe('ru-M')
    expect(pickVoice(voices, '', 'de')!.voiceURI).toBe('en-A')
    expect(pickVoice([], '', 'en')).toBeNull()
  })
})

/** A stand-in for speech: records what it is asked, and ends each sentence when told to. */
function fakeSpeech() {
  const spoken: SpeechSynthesisUtterance[] = []
  const calls: string[] = []
  const speech: SpeechLike = {
    speak: (u) => {
      spoken.push(u)
      calls.push('speak')
    },
    cancel: () => calls.push('cancel'),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    getVoices: () => [],
  }
  const end = async () => {
    spoken.at(-1)!.onend!(new Event('end') as SpeechSynthesisEvent)
    await new Promise((r) => setTimeout(r, 0))
  }
  return { speech, spoken, calls, end }
}

const part = (index: number, texts: string[]): NarratorPart => ({
  index,
  sentences: texts.map((text) => ({ text, range: document.createRange() })),
})

function host(parts: NarratorPart[]) {
  const shown: string[] = []
  const states: string[] = []
  const h: NarratorHost = {
    here: async () => parts[0],
    after: async (index) => parts.find((p) => p.index === index + 1) ?? null,
    show: (s, index) => shown.push(s ? `${index}:${s.text}` : 'cleared'),
    lang: () => 'en',
    changed: (state) => states.push(state),
  }
  return { h, shown, states }
}

const utterance = (text: string) => ({ text }) as SpeechSynthesisUtterance

describe('the narrator', () => {
  it('reads sentence after sentence, marks each, and goes on into the next part', async () => {
    const { speech, spoken, end } = fakeSpeech()
    const { h, shown, states } = host([part(0, ['A.', 'B.']), part(1, []), part(2, ['C.'])])
    const n = new Narrator(h, speech, () => ({ voice: '', rate: 1.25 }), utterance)
    await n.play()
    expect(spoken.map((u) => u.text)).toEqual(['A.'])
    expect(spoken[0].rate).toBe(1.25)
    await end()
    await end()
    // An empty part is passed over.
    expect(spoken.map((u) => u.text)).toEqual(['A.', 'B.', 'C.'])
    await end()
    expect(shown).toEqual(['0:A.', '0:B.', '2:C.', 'cleared'])
    expect(states).toEqual(['playing', 'idle'])
    expect(n.state).toBe('idle')
  })

  it('pauses, resumes and skips, and a sentence cut short does not move it on', async () => {
    const { speech, spoken, calls, end } = fakeSpeech()
    const { h } = host([part(0, ['A.', 'B.', 'C.'])])
    const n = new Narrator(h, speech, () => ({ voice: '', rate: 1 }), utterance)
    await n.play()
    n.pause()
    expect(n.state).toBe('paused')
    n.resume()
    expect(calls).toContain('pause')
    expect(calls).toContain('resume')
    await n.skip(1)
    expect(spoken.at(-1)!.text).toBe('B.')
    // The first utterance ending late — it was cancelled — changes nothing.
    spoken[0].onend!(new Event('end') as SpeechSynthesisEvent)
    await new Promise((r) => setTimeout(r, 0))
    expect(spoken.at(-1)!.text).toBe('B.')
    await n.skip(-1)
    expect(spoken.at(-1)!.text).toBe('A.')
    await end()
    expect(spoken.at(-1)!.text).toBe('B.')
  })

  it('stops, cancelling the speech and clearing the mark', async () => {
    const { speech, calls } = fakeSpeech()
    const { h, shown } = host([part(0, ['A.'])])
    const n = new Narrator(h, speech, () => ({ voice: '', rate: 1 }), utterance)
    await n.play()
    n.stop()
    expect(calls.at(-1)).toBe('cancel')
    expect(shown.at(-1)).toBe('cleared')
    expect(n.state).toBe('idle')
  })

  it('does not start when there is nothing to read', async () => {
    const { speech, spoken } = fakeSpeech()
    const changed = vi.fn()
    const n = new Narrator(
      {
        here: async () => null,
        after: async () => null,
        show: () => {},
        lang: () => 'en',
        changed,
      },
      speech,
      () => ({ voice: '', rate: 1 }),
      utterance
    )
    await n.play()
    expect(spoken).toHaveLength(0)
    expect(n.state).toBe('idle')
  })
})
