/**
 * Reading aloud in the running app. The platform's speech is swapped for a stand-in that records
 * each sentence it is given and ends it a moment later — so the run makes no sound and can follow
 * exactly what would have been said — and then, once, the platform's own voices are asked for.
 *
 * With the rich book and the plain PDF (written for the run and removed after it): the header's
 * Read aloud starts at the page on screen and marks each sentence as it is read; it goes on into
 * the next chapter, and into the next page of a PDF, turning to it; pause, resume and skip do what
 * they say; reading can start from selected words; the chosen voice and speed are used; closing
 * the tab stops it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalRaw, evalJson } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'
import { buildPlainPdf } from '../fixtures/books/pdfFixture'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader speech e2e'
const BOOK = `${DIR}/rich.epub`
const PDF = `${DIR}/plain.pdf`

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  /** The stand-in for speech: what it said, in order, each sentence ended after 'pace' ms. */
  const fake = window.__abeleFakeSpeech ??= (() => {
    const s = { said: [], calls: [], paused: false, pace: 40, current: null }
    const endLater = (u) => setTimeout(() => {
      if (s.current !== u) return
      if (s.paused) { s.held = u; return }
      s.current = null
      u.onend?.({})
    }, s.pace)
    s.speech = {
      speak(u) { s.said.push(u); s.calls.push('speak'); s.current = u; s.onSpeak?.(u); endLater(u) },
      cancel() { s.calls.push('cancel'); const u = s.current; s.current = null; u?.onerror?.({ error: 'interrupted' }) },
      pause() { s.calls.push('pause'); s.paused = true },
      resume() { s.calls.push('resume'); s.paused = false; if (s.held) { const u = s.held; s.held = null; endLater(u) } },
      getVoices() { return window.speechSynthesis?.getVoices() ?? [] },
    }
    s.make = (text) => ({ text, voice: null, lang: '', rate: 1, onend: null, onerror: null })
    return s
  })()
  window.__abeleTest.reader.hooks.speech = { speech: fake.speech, make: fake.make }
  const reset = (pace = 40) => { fake.said = []; fake.calls = []; fake.paused = false; fake.pace = pace; fake.current = null; fake.held = null }
  const said = () => fake.said.map((u) => u.text)
  const open = async (path) => {
    const leaf = app.workspace.getLeaf('tab')
    await leaf.setViewState({ type: 'abele-book', state: { file: path }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready', 15000)
    await wait(600)
    return { leaf, view }
  }
  const action = (view, label) => view.containerEl.querySelector('.view-action[aria-label="' + label + '"]')
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    44_000
  )

describe.skipIf(!available)('reading a book aloud', () => {
  let saved: unknown = null

  beforeAll(() => {
    saved = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    const files = {
      'rich.epub': Buffer.from(buildRichEpub()).toString('base64'),
      'plain.pdf': Buffer.from(buildPlainPdf()).toString('base64'),
    }
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        for (const [name, data] of Object.entries(${JSON.stringify(files)})) {
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          await app.vault.createBinary(${JSON.stringify(DIR)} + '/' + name, bytes.buffer)
        }
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, pdfLayout: 'scrolled', ttsVoice: '', ttsRate: 1 }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        window.__abeleTest.reader.hooks.speech = null
        delete window.__abeleFakeSpeech
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(saved)}
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      44_000
    )
  }, 60_000)

  it('reads from the page on screen, marking each sentence, and goes on into the next chapter', () => {
    const r = run<{
      error?: string
      offered?: boolean
      first?: string[]
      marked?: boolean
      bar?: boolean
      state?: string
      reachedTwo?: boolean
      chapter?: string
    }>(`
      reset(40)
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(view.model.toc[0].href)
      await wait(800)
      const button = action(view, 'Read aloud')
      const offered = !!button
      button.click()
      await until(() => fake.said.length >= 3, 5000)
      const first = said().slice(0, 3)
      const overlay = view.engine.renderer.getContents()[0].overlayer.element
      const marked = overlay.querySelectorAll('g').length > 0
      const bar = !!view.contentEl.querySelector('.abele-book-speech')
      const state = view.model.speech
      // Faster, to reach the next chapter: its heading is read, and the page turned to it.
      fake.pace = 2
      const reachedTwo = !!(await until(() => said().includes('Chapter 2'), 20000))
      await until(() => view.model.chapter.startsWith('Chapter 2'), 5000)
      const chapter = view.model.chapter
      leaf.detach()
      return { offered, first, marked, bar, state, reachedTwo, chapter }
    `)
    expect(r.error).toBeUndefined()
    expect(r.offered).toBe(true)
    expect(r.first![0]).toBe('Chapter 1')
    expect(r.first![1]).toMatch(/^A claim that needs a source\./)
    expect(r.marked).toBe(true)
    expect(r.bar).toBe(true)
    expect(r.state).toBe('playing')
    expect(r.reachedTwo).toBe(true)
    expect(r.chapter).toMatch(/^Chapter 2/)
  })

  it('pauses, goes on, skips a sentence and goes back, and stops when the tab is closed', () => {
    const r = run<{
      error?: string
      paused?: string
      heldAt?: number
      resumed?: boolean
      skipped?: string[]
      back?: string
      closed?: { state: string; cancelled: boolean; after: number; before: number }
    }>(`
      reset(300)
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(view.model.toc[0].href)
      await wait(600)
      view.reading.speech.toggle()
      await until(() => fake.said.length === 1, 3000)
      const bar = () => view.contentEl.querySelectorAll('.abele-book-speech .abele-obsidian-icon')
      const click = (label) => [...bar()].find((i) => i.getAttribute('aria-label') === label).click()
      click('Pause')
      await wait(50)
      const paused = view.model.speech
      await wait(600)
      const heldAt = fake.said.length
      click('Go on reading')
      const resumed = !!(await until(() => fake.said.length === heldAt + 1, 3000))
      const before = said().at(-1)
      click('Skip to the next sentence')
      await wait(50)
      const skipped = [before, said().at(-1)]
      click('Read the last sentence again')
      await wait(50)
      const back = said().at(-1)
      const count = fake.said.length
      leaf.detach()
      await wait(700)
      return { paused, heldAt, resumed, skipped, back,
        closed: { state: view.model.speech, cancelled: fake.calls.at(-1) === 'cancel', after: fake.said.length, before: count } }
    `)
    expect(r.error).toBeUndefined()
    expect(r.paused).toBe('paused')
    expect(r.heldAt).toBe(1)
    expect(r.resumed).toBe(true)
    expect(r.skipped![1]).not.toBe(r.skipped![0])
    expect(r.back).toBe(r.skipped![0])
    expect(r.closed).toMatchObject({ state: 'idle', cancelled: true })
    expect(r.closed!.after).toBe(r.closed!.before)
  })

  it('reads from words selected, in the chosen voice and at the chosen speed', () => {
    const r = run<{
      error?: string
      first?: string
      rate?: number
      voice?: string | null
      wanted?: string | null
    }>(`
      reset(300)
      const voices = window.speechSynthesis?.getVoices() ?? []
      const wanted = voices.find((v) => v.lang.startsWith('en'))?.voiceURI ?? null
      const cfg = window.__abeleTest.AbeleConfig.getInstance()
      cfg.reader = { ...cfg.reader, ttsRate: 1.5, ttsVoice: wanted ?? '' }
      await cfg.saveSettings()
      const { leaf, view } = await open(${JSON.stringify(BOOK)})
      await view.engine.goTo(view.model.toc[2].href)
      await wait(600)
      const doc = view.engine.renderer.getContents()[0].doc
      const p = doc.querySelector('p')
      const range = doc.createRange(); range.setStart(p.firstChild, 6); range.setEnd(p.firstChild, 10)
      doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range)
      await until(() => view.model.selection, 3000)
      // The bar comes once the words have rested: it stays hidden while they are being selected.
      await until(() => view.contentEl.querySelector('.abele-book-selection'), 3000)
      const icon = [...view.contentEl.querySelectorAll('.abele-book-selection .abele-obsidian-icon')]
        .find((i) => i.getAttribute('aria-label') === 'Read aloud from here')
      icon.click()
      await until(() => fake.said.length, 3000)
      const u = fake.said[0]
      view.reading.speech.stop()
      cfg.reader = { ...cfg.reader, ttsRate: 1, ttsVoice: '' }
      await cfg.saveSettings()
      leaf.detach()
      return { first: u.text, rate: u.rate, voice: u.voice?.voiceURI ?? null, wanted }
    `)
    expect(r.error).toBeUndefined()
    expect(r.first).toBe(
      'Plain text of the chapter, long enough to wrap onto several lines of a page and fill it.'
    )
    expect(r.rate).toBe(1.5)
    if (r.wanted) expect(r.voice).toBe(r.wanted)
  })

  it('reads a PDF page by page, a box over the sentence, turning to the next page', () => {
    const r = run<{ error?: string; first?: string; boxes?: number[]; page?: number }>(`
      reset(400)
      const { leaf, view } = await open(${JSON.stringify(PDF)})
      await view.engine.goTo(0)
      await until(() => view.engine.renderer.getContents().some((c) => c.doc?.querySelector('.textLayer span')), 8000)
      await wait(500)
      view.reading.speech.toggle()
      await until(() => fake.said.length, 3000)
      const first = said()[0]
      // Every sentence of the first page gets its box, the page's text drawn anew under it or not.
      const boxes = []
      const page0 = () => view.engine.renderer.getContents().find((c) => c.index === 0)?.doc
      for (let i = 0; i < 3; i++) {
        await until(() => fake.said.length === i + 1, 3000)
        boxes.push(page0()?.querySelectorAll('.abele-speaking__box').length ?? 0)
      }
      fake.pace = 5
      // The page on screen as the next page's first sentence begins, before it reads on.
      let page = -1
      fake.onSpeak = (u) => { if (u.text.startsWith('Page 2 of the test document')) page = view.engine.renderer.index }
      await until(() => page >= 0, 15000)
      fake.onSpeak = null
      view.reading.speech.stop()
      leaf.detach()
      return { first, boxes, page }
    `)
    expect(r.error).toBeUndefined()
    expect(r.first).toMatch(/^Page 1 of the test document/)
    expect(r.boxes).toHaveLength(3)
    expect(
      r.boxes!.every((n) => n > 0),
      String(r.boxes)
    ).toBe(true)
    expect(r.page).toBe(1)
  })

  it('has the platform’s own voices to read with', () => {
    const r = run<{ error?: string; voices?: number; english?: boolean }>(`
      const load = () => window.speechSynthesis?.getVoices() ?? []
      await until(() => load().length, 5000)
      const voices = load()
      return { voices: voices.length, english: voices.some((v) => v.lang.startsWith('en')) }
    `)
    expect(r.error).toBeUndefined()
    expect(r.voices).toBeGreaterThan(0)
    expect(r.english).toBe(true)
  })
})
