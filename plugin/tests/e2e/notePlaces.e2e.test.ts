/**
 * Notes coming back where they were left, in the running app, in reading view and in the editor:
 *
 * - a long note scrolled far down, left for another note in the same tab and opened again comes
 *   back at that place;
 * - the same note opened through a link to a heading near its top lands on the heading, and
 *   stays there — the saved place is not put back a moment later;
 * - the highlights note of a book, left scrolled far from a highlight, opened from the book at
 *   that highlight lands on the highlight.
 *
 * Then the same on a phone: 390×844 under `emulateMobile`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'
import { WAIT_PRELUDE, wait as pause } from './helpers/wait'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele note places e2e'
const LONG = `${DIR}/long-sample.md`
const OTHER = `${DIR}/other-sample.md`
const GROWING = `${DIR}/growing-sample.md`
const EMBEDDED = `${DIR}/embedded-sample.md`
const BOOK = `${DIR}/rich.epub`

/** 200 sections, four lines each: "## Section n", a blank, a paragraph, a blank. */
/**
 * A long note that grows after it opens: embeds of another note and diagrams drawn a moment
 * later, above the place it is left at, so the place moves as the note is measured again.
 */
const GROWING_TEXT = Array.from({ length: 120 }, (_, i) =>
  [
    `## Part ${i + 1}`,
    '',
    `The text of part ${i + 1}, long enough to wrap once or twice in a narrow pane.`,
    '',
    ...(i % 10 === 5
      ? ['![[embedded-sample]]', '', '```mermaid', 'graph TD; A-->B; B-->C; C-->D', '```', '']
      : []),
  ].join('\n')
).join('\n')

const EMBEDDED_TEXT = Array.from({ length: 12 }, (_, i) => `- embedded item ${i + 1}`).join('\n')

const LONG_TEXT = Array.from(
  { length: 200 },
  (_, i) =>
    `## Section ${i + 1}\n\nThe paragraph of section ${i + 1}, long enough to wrap a little on a narrow screen.\n`
).join('\n')

const PRELUDE = `
  ${WAIT_PRELUDE}
  // These are observation windows, not readiness sleeps: a late restore must still be caught.
  const observeRestoredPlace = () => wait(1500)
  const observeExplicitTarget = () => wait(1800)
  const noteDrawn = async (leaf, text) => {
    const ready = await until(() => {
      const v = leaf.view
      const selector = v.getMode() === 'preview' ? '.markdown-preview-view' : '.cm-content'
      return [...v.containerEl.querySelectorAll(selector)].some(el =>
        el.getClientRects().length && el.textContent.includes(text))
    })
    if (!ready) throw Error('The note did not draw: ' + text)
  }
  const file = (p) => app.vault.getAbstractFileByPath(p)
  const notesOf = (path) => app.workspace.getLeavesOfType('markdown').filter((l) => l.view.file?.path === path)
  const scrollOf = (leaf) => leaf.view.currentMode.getScroll()
  /** A new tab, or the lone leaf when there is no tab group to add one to. */
  const newLeaf = () => { try { return app.workspace.getLeaf('tab') } catch { return app.workspace.createLeafInParent(app.workspace.rootSplit, 0) } }
  /** The note scrolled so line \`line\` is at its top, then given time to be saved. */
  const scrollTo = async (leaf, line) => {
    const v = leaf.view
    for (let i = 0; i < 20; i++) {
      v.currentMode.applyScroll(line)
      await wait(100)
      if (Math.abs(scrollOf(leaf) - line) < 3) break
    }
    await wait(1500)
    return scrollOf(leaf)
  }
  /**
   * The furthest the note was scrolled over the next moments, sampled often: a saved place put
   * back and then scrolled away from again still shows here.
   */
  const furthest = (leafOf) => {
    let max = 0
    let stop = false
    const tick = () => {
      const l = leafOf()
      if (l?.view?.currentMode) max = Math.max(max, l.view.currentMode.getScroll())
      if (!stop) setTimeout(tick, 20)
    }
    tick()
    return () => { stop = true; return max }
  }
  /** Whether an element whose text holds \`text\` shows inside the note's scroller. */
  const shows = (leaf, selector, text) => {
    const v = leaf.view
    const preview = v.getMode() === 'preview'
    const scroller = v.containerEl.querySelector(preview ? '.markdown-reading-view .markdown-preview-view' : '.cm-scroller')
    const s = scroller.getBoundingClientRect()
    return [...v.containerEl.querySelectorAll(selector)].some((el) => {
      if (!el.textContent.includes(text)) return false
      const b = el.getBoundingClientRect()
      return b.bottom > s.top && b.top < s.bottom
    })
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      const mode = app.vault.getConfig('defaultViewMode')
      try { return await (async () => { ${body} })() } catch (e) { return { error: String((e && e.stack) || e) } }
      finally {
        app.vault.setConfig('defaultViewMode', mode)
        for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
        for (const l of app.workspace.getLeavesOfType('markdown'))
          if (l.view.file?.path.startsWith(${JSON.stringify(DIR)})) l.detach()
      }
    })()`,
    120_000
  )

interface Back {
  left: number
  back: number
  later: number
}

interface Jump {
  saved: number
  landed: number
  later: number
  /** The furthest it was scrolled while it opened. */
  peak: number
  shows: boolean
  showsLater: boolean
}

/** Scroll far down, open another note in the tab, open it again: it is back at its place. */
const comesBack = (): Record<string, Back> & { error?: string } =>
  run(`
    const out = {}
    for (const m of ['preview', 'source']) {
      app.vault.setConfig('defaultViewMode', m)
      const leaf = newLeaf()
      await leaf.openFile(file(${JSON.stringify(LONG)}), { active: true })
      await noteDrawn(leaf, 'Section')
      const left = await scrollTo(leaf, 400)
      await leaf.openFile(file(${JSON.stringify(OTHER)}), { active: true })
      await noteDrawn(leaf, 'A short note.')
      await leaf.openFile(file(${JSON.stringify(LONG)}), { active: true })
      await until(() => Math.abs(scrollOf(leaf) - left) < 3)
      const back = scrollOf(leaf)
      await observeRestoredPlace()
      out[m] = { left, back, later: scrollOf(leaf) }
      // Scrolled elsewhere and the tab closed at once, before anything saved it on its own.
      const left2 = await (async () => {
        leaf.view.currentMode.applyScroll(300)
        // Stay inside the one-second sampling interval: closing must save this place itself.
        if (!(await until(() => Math.abs(scrollOf(leaf) - 300) < 3, 500)))
          throw Error('The close-time scroll did not land before periodic sampling')
        return scrollOf(leaf)
      })()
      leaf.detach()
      await until(() => !leaf.containerEl.isConnected)
      const again = newLeaf()
      await again.openFile(file(${JSON.stringify(LONG)}), { active: true })
      await until(() => Math.abs(scrollOf(again) - left2) < 3)
      const back2 = scrollOf(again)
      await observeRestoredPlace()
      out[m + ':closed'] = { left: left2, back: back2, later: scrollOf(again) }
      again.detach()
      await until(() => !again.containerEl.isConnected)
    }
    return out
  `)

/** Left far down, then opened through a link to a heading near the top. */
const headingWins = (): Record<string, Jump> & { error?: string } =>
  run(`
    const out = {}
    for (const m of ['preview', 'source']) {
      app.vault.setConfig('defaultViewMode', m)
      const leaf = newLeaf()
      await leaf.openFile(file(${JSON.stringify(LONG)}), { active: true })
      await noteDrawn(leaf, 'Section')
      const saved = await scrollTo(leaf, 500)
      await leaf.openFile(file(${JSON.stringify(OTHER)}), { active: true })
      await noteDrawn(leaf, 'A short note.')
      app.workspace.setActiveLeaf(leaf, { focus: true })
      const peak = furthest(() => leaf)
      await app.workspace.openLinkText('long-sample#Section 5', ${JSON.stringify(OTHER)}, false)
      await until(() => leaf.view.file?.path === ${JSON.stringify(LONG)}, 5000)
      const sel = m === 'preview' ? 'h2' : '.cm-line'
      await until(() => shows(leaf, sel, 'Section 5'))
      const landed = scrollOf(leaf)
      const shown = shows(leaf, sel, 'Section 5')
      await observeExplicitTarget()
      out[m] = { saved, landed, later: scrollOf(leaf), peak: peak(), shows: shown, showsLater: shows(leaf, sel, 'Section 5') }
      leaf.detach()
      await until(() => !leaf.containerEl.isConnected)
    }
    return out
  `)

/** The highlights note left far from the highlight, then opened from the book at it. */
const highlightWins = (): Record<string, Jump> & { error?: string } =>
  run(`
    const leaf = newLeaf()
    await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
    const view = leaf.view
    await until(() => view.model?.status === 'ready', 15000)
    await until(() => view.reading && view.engine.renderer.getContents()[0]?.doc?.querySelector('h1'))
    await view.engine.goTo(2)
    await until(() => view.engine.renderer.getContents()[0]?.doc?.querySelector('h1')?.textContent === 'Chapter 3')
    const doc = view.engine.renderer.getContents()[0]?.doc
    const h1 = doc.querySelector('h1')
    const range = doc.createRange()
    range.setStart(h1.firstChild, 0)
    range.setEnd(h1.firstChild, 7)
    doc.getSelection().removeAllRanges()
    doc.getSelection().addRange(range)
    await until(() => view.model.selection, 3000)
    const h = await view.reading.highlight('yellow')
    if (!h) throw new Error('no highlight made')
    const path = await until(() => view.reading.notes()[0]?.path, 5000)
    // The highlight far up, a long run of text under it to be left in.
    const filler = Array.from({ length: 150 }, (_, i) => 'Line ' + (i + 1) + ' of the reader’s own writing.').join('\\n\\n')
    await app.vault.process(file(path), (md) => md + '\\n\\n' + filler + '\\n')
    const endLine = (await app.vault.read(file(path))).trimEnd().split('\\n').length - 1
    await until(() => app.metadataCache.getFileCache(file(path))?.sections?.at(-1)?.position.end.line === endLine)
    const out = {}
    for (const m of ['preview', 'source']) {
      app.vault.setConfig('defaultViewMode', m)
      const note = newLeaf()
      await note.openFile(file(path), { active: true })
      await noteDrawn(note, 'Chapter')
      const saved = await scrollTo(note, 250)
      note.detach()
      await until(() => !note.containerEl.isConnected)
      app.workspace.setActiveLeaf(leaf, { focus: true })
      const peak = furthest(() => notesOf(path)[0])
      await view.reading.openNote(h)
      const nl = await until(() => notesOf(path)[0], 5000)
      const sel = m === 'preview' ? '.abele-line-flash, .callout' : '.abele-line-flash, .cm-line, .cm-callout'
      await until(() => shows(nl, sel, 'Chapter'))
      const landed = scrollOf(nl)
      const shown = shows(nl, sel, 'Chapter')
      await observeExplicitTarget()
      out[m] = { saved, landed, later: scrollOf(nl), peak: peak(), shows: shown, showsLater: shows(nl, sel, 'Chapter') }
      for (const l of notesOf(path)) l.detach()
      await until(() => notesOf(path).length === 0)
    }
    return out
  `)

interface Settle {
  /** The line at the top of the note at every frame after it opened, to a tenth. */
  tops: number[]
  /** The frames at which the note was scrolled to a place by code: the restore's own scrolls. */
  scrolled: number[]
  /** Frames at which the person's wheel turned, when it did. */
  wheelFrom?: number
  saved: number
  end: number
}

/**
 * The growing note left far down, opened again, and its scroller read at every frame; with
 * `wheel`, the person starts scrolling up a few frames after it opened.
 */
const settles = (wheel: boolean): Record<string, Settle> & { error?: string } =>
  run(`
    const frame = () => new Promise((r) => requestAnimationFrame(r))
    const out = {}
    for (const m of ['preview', 'source']) {
      app.vault.setConfig('defaultViewMode', m)
      const leaf = newLeaf()
      await leaf.openFile(file(${JSON.stringify(GROWING)}), { active: true })
      await wait(1500)
      const saved = await scrollTo(leaf, 300)
      await wait(1000)
      await leaf.openFile(file(${JSON.stringify(OTHER)}), { active: true })
      await noteDrawn(leaf, 'A short note.')
      // Every scroll made to the note from here on, by the frame it was made at: the restore's.
      let at = -1
      const scrolled = []
      const v = leaf.view
      const renderer = v.previewMode.renderer
      const own = { set: v.setEphemeralState, apply: renderer.applyScroll }
      v.setEphemeralState = function (st) { if (st && st.scroll !== undefined) scrolled.push(at); return own.set.call(this, st) }
      renderer.applyScroll = function (...a) { scrolled.push(at); return own.apply.apply(this, a) }
      await leaf.openFile(file(${JSON.stringify(GROWING)}), { active: true })
      const scroller = () => m === 'preview'
        ? leaf.view.containerEl.querySelector('.markdown-reading-view > .markdown-preview-view')
        : leaf.view.containerEl.querySelector('.cm-scroller')
      const tops = []
      const WHEEL_FROM = 12
      for (let i = 0; i < 150; i++) {
        at = i
        await frame()
        const s = scroller()
        if (${wheel} && i >= WHEEL_FROM && i < WHEEL_FROM + 30) {
          s.dispatchEvent(new WheelEvent('wheel', { deltaY: -40, bubbles: true, cancelable: true }))
          s.scrollTop -= 40
        }
        // The line at the top of the view, not the scroller's pixels: reading view keeps the
        // lines on screen still as blocks above them are drawn, by moving its pixels.
        tops.push(Math.round(scrollOf(leaf) * 10) / 10)
      }
      delete v.setEphemeralState
      renderer.applyScroll = own.apply
      out[m] = { tops, scrolled, saved, end: scrollOf(leaf), ...(${wheel} ? { wheelFrom: WHEEL_FROM } : {}) }
      leaf.detach()
      await until(() => !leaf.containerEl.isConnected)
    }
    return out
  `)

const expectSettles = (r: Record<string, Settle> & { error?: string }) => {
  expect(r.error).toBeUndefined()
  for (const m of ['preview', 'source']) {
    const s = r[m]
    const trace = `${m}: ${JSON.stringify({ ...s, tops: s.tops.join(' ') })}`
    // Embeds and diagrams change the renderer's line-to-pixel mapping while it draws. That
    // briefly moves the reported top line even on 1.61.0 with only one restore scroll. Once
    // rendering settles, the visible line must stop moving altogether, not merely stay near
    // the saved line; a late jump or repeated restore would fail here.
    expect(new Set(s.tops.slice(30)).size, trace).toBe(1)
    // Put back once, corrected a couple of times at most as the note is measured — and only
    // while it opens, never again once it has been still.
    expect(s.scrolled.length, trace).toBeGreaterThan(0)
    expect(s.scrolled.length, trace).toBeLessThanOrEqual(3)
    expect(Math.max(...s.scrolled), trace).toBeLessThan(30)
    // Near the place, the note having moved it a little as it was measured.
    expect(Math.abs(s.end - s.saved), trace).toBeLessThan(5)
  }
}

const expectGivesWay = (r: Record<string, Settle> & { error?: string }) => {
  expect(r.error).toBeUndefined()
  for (const m of ['preview', 'source']) {
    const s = r[m]
    const from = s.wheelFrom!
    const after = s.tops.slice(from)
    const trace = `${m}: ${JSON.stringify({ ...s, tops: s.tops.join(' ') })}`
    // Not one scroll to the saved place once the person has turned the wheel.
    expect(
      s.scrolled.filter((f) => f >= from),
      trace
    ).toEqual([])
    // And the note stays where they took it: once well above the place, never back near it.
    // The view nudges a line or so on its own as diagrams above are drawn; that is not ours.
    const away = after.findIndex((t) => t < s.saved - 10)
    expect(away, trace).toBeGreaterThan(-1)
    expect(Math.max(...after.slice(away)), trace).toBeLessThan(s.saved - 5)
    expect(after[0] - after.at(-1)!, trace).toBeGreaterThan(20)
  }
}

const expectBack = (r: Record<string, Back> & { error?: string }) => {
  expect(r.error).toBeUndefined()
  expect(Object.keys(r).sort()).toEqual(['preview', 'preview:closed', 'source', 'source:closed'])
  for (const m of Object.keys(r)) {
    const b = r[m]
    expect(b.left, m).toBeGreaterThan(100)
    expect(Math.abs(b.back - b.left), `${m}: ${JSON.stringify(b)}`).toBeLessThan(3)
    expect(Math.abs(b.later - b.left), `${m}: ${JSON.stringify(b)}`).toBeLessThan(3)
  }
}

const expectJump = (r: Record<string, Jump> & { error?: string }, limit: number) => {
  expect(r.error).toBeUndefined()
  for (const m of ['preview', 'source']) {
    const j = r[m]
    expect(j.saved, m).toBeGreaterThan(limit * 2)
    expect(j.shows, `${m}: ${JSON.stringify(j)}`).toBe(true)
    expect(j.showsLater, `${m}: ${JSON.stringify(j)}`).toBe(true)
    expect(j.landed, `${m}: ${JSON.stringify(j)}`).toBeLessThan(limit)
    expect(j.later, `${m}: ${JSON.stringify(j)}`).toBeLessThan(limit)
    // Never taken to the saved place on the way, not even for a moment.
    expect(j.peak, `${m}: ${JSON.stringify(j)}`).toBeLessThan(limit)
  }
}

const reload = async (how: string): Promise<void> => {
  await reloadApp(how)
  runCli(['dev:debug', 'on'], 30_000)
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`
  )
}

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  const sized = evalAsync<boolean>(`(async () => {
    ${WAIT_PRELUDE}
    return !!(await until(() => innerWidth === ${width} && innerHeight === ${height}))
  })()`)
  if (!sized) throw new Error('The window did not reach its requested size')
}

const createFixtures = () => {
  const epub = Buffer.from(buildRichEpub()).toString('base64')
  evalRaw(
    `(async () => {
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (old) await app.vault.delete(old, true)
      await app.vault.createFolder(${JSON.stringify(DIR)})
      await app.vault.create(${JSON.stringify(LONG)}, ${JSON.stringify(LONG_TEXT)})
      await app.vault.create(${JSON.stringify(OTHER)}, 'A short note.\\n')
      await app.vault.create(${JSON.stringify(EMBEDDED)}, ${JSON.stringify(EMBEDDED_TEXT)})
      await app.vault.create(${JSON.stringify(GROWING)}, ${JSON.stringify(GROWING_TEXT)})
      const bytes = Uint8Array.from(atob(${JSON.stringify(epub)}), (c) => c.charCodeAt(0))
      await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
      return 'ok'
    })()`,
    44_000
  )
}

const removeFixtures = () => {
  evalRaw(
    `(async () => {
      for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
      const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (dir) await app.vault.delete(dir, true)
      return 'ok'
    })()`,
    44_000
  )
}

describe.skipIf(!available)('notes come back where they were left', () => {
  // These probes block on synchronous CLI calls for several seconds apiece. Let Vitest send
  // each result to its runner before starting the next one; otherwise its pending task-update
  // RPC times out even when every assertion passed.
  afterEach(async () => { await pause(0) })

  beforeAll(() => {
    expect(
      evalJson<boolean>('window.__abeleTest.AbeleConfig.getInstance().rememberNotePlaces')
    ).toBe(true)
    createFixtures()
  }, 60_000)

  afterAll(() => {
    if (available) removeFixtures()
  }, 60_000)

  it('a long note left far down comes back there', () => {
    expectBack(comesBack())
  })

  it('a link to a heading lands on the heading, not on the saved place', () => {
    expectJump(headingWins(), 60)
  })

  it("a book's highlight lands on the highlight, not on the saved place", () => {
    expectJump(highlightWins(), 60)
  })

  it('a note that grows as it renders comes back without shaking', () => {
    expectSettles(settles(false))
  })

  it("the person's own scrolling is never pulled back to the saved place", () => {
    expectGivesWay(settles(true))
  })

  it('the deleted notes take their places with them', () => {
    const r = run<{ before: number; after: number }>(`
      const key = 'abele-note-places'
      const count = () => Object.keys(app.loadLocalStorage(key) ?? {}).filter((p) => p.startsWith(${JSON.stringify(DIR)})).length
      // Wait for the actual debounced write, not an assumed save delay.
      if (!(await until(() => count() > 0))) throw Error('No note places were persisted')
      const before = count()
      const tmp = ${JSON.stringify(DIR)} + '/gone-sample.md'
      await app.vault.create(tmp, 'x')
      await app.vault.delete(file(tmp))
      await app.vault.delete(file(${JSON.stringify(OTHER)}))
      await app.vault.create(${JSON.stringify(OTHER)}, 'A short note.\\n')
      await app.vault.rename(file(${JSON.stringify(LONG)}), ${JSON.stringify(DIR)} + '/renamed-sample.md')
      await until(() => {
        const places = app.loadLocalStorage(key) ?? {}
        return places[${JSON.stringify(DIR)} + '/renamed-sample.md'] && !places[${JSON.stringify(LONG)}]
      })
      const places = app.loadLocalStorage(key) ?? {}
      const after = places[${JSON.stringify(DIR)} + '/renamed-sample.md'] && !places[${JSON.stringify(LONG)}] ? 1 : 0
      await app.vault.rename(file(${JSON.stringify(DIR)} + '/renamed-sample.md'), ${JSON.stringify(LONG)})
      return { before, after }
    `)
    expect(r.before).toBeGreaterThan(0)
    expect(r.after).toBe(1)
  })

  describe('on a phone', () => {
    let size: [number, number] = [0, 0]

    beforeAll(async () => {
      size = evalJson<[number, number]>(
        `require('@electron/remote').getCurrentWindow().getContentSize()`
      )
      await reload('app.emulateMobile(true)')
      await setWindowSize(390, 844)
      await reload('window.location.reload()')
      // Afresh: the book's words are highlighted already, and a highlight is not made twice.
      createFixtures()
    }, 240_000)

    afterAll(async () => {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reload('app.emulateMobile(false)')
    }, 180_000)

    it('a long note left far down comes back there', () => {
      expect(evalJson<boolean>('app.isMobile')).toBe(true)
      expectBack(comesBack())
    })

    it('a link to a heading lands on the heading', () => {
      expectJump(headingWins(), 60)
    })

    it("a book's highlight lands on the highlight", () => {
      expectJump(highlightWins(), 60)
    })

    it('a note that grows as it renders comes back without shaking', () => {
      expectSettles(settles(false))
    })

    it("the person's own scrolling is never pulled back", () => {
      expectGivesWay(settles(true))
    })
  })
})
