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
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele note places e2e'
const LONG = `${DIR}/long-sample.md`
const OTHER = `${DIR}/other-sample.md`
const BOOK = `${DIR}/rich.epub`

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 200 sections, four lines each: "## Section n", a blank, a paragraph, a blank. */
const LONG_TEXT = Array.from(
  { length: 200 },
  (_, i) =>
    `## Section ${i + 1}\n\nThe paragraph of section ${i + 1}, long enough to wrap a little on a narrow screen.\n`
).join('\n')

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 10000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = fn(); if (v) return v } catch {} await wait(100) }
    return null
  }
  const file = (p) => app.vault.getAbstractFileByPath(p)
  const notesOf = (path) => app.workspace.getLeavesOfType('markdown').filter((l) => l.view.file?.path === path)
  const scrollOf = (leaf) => leaf.view.currentMode.getScroll()
  /** A new tab, or the lone leaf when there is no tab group to add one to. */
  const newLeaf = () => { try { return app.workspace.getLeaf('tab') } catch { return app.workspace.getLeaf(false) } }
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
      await wait(800)
      const left = await scrollTo(leaf, 400)
      await leaf.openFile(file(${JSON.stringify(OTHER)}), { active: true })
      await wait(500)
      await leaf.openFile(file(${JSON.stringify(LONG)}), { active: true })
      await wait(1200)
      const back = scrollOf(leaf)
      await wait(1500)
      out[m] = { left, back, later: scrollOf(leaf) }
      // Scrolled elsewhere and the tab closed at once, before anything saved it on its own.
      const left2 = await (async () => { leaf.view.currentMode.applyScroll(300); await wait(200); return scrollOf(leaf) })()
      leaf.detach()
      await wait(300)
      const again = newLeaf()
      await again.openFile(file(${JSON.stringify(LONG)}), { active: true })
      await wait(1200)
      const back2 = scrollOf(again)
      await wait(1500)
      out[m + ':closed'] = { left: left2, back: back2, later: scrollOf(again) }
      again.detach()
      await wait(300)
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
      await wait(800)
      const saved = await scrollTo(leaf, 500)
      await leaf.openFile(file(${JSON.stringify(OTHER)}), { active: true })
      await wait(500)
      app.workspace.setActiveLeaf(leaf, { focus: true })
      const peak = furthest(() => leaf)
      await app.workspace.openLinkText('long-sample#Section 5', ${JSON.stringify(OTHER)}, false)
      await until(() => leaf.view.file?.path === ${JSON.stringify(LONG)}, 5000)
      await wait(600)
      const sel = m === 'preview' ? 'h2' : '.cm-line'
      const landed = scrollOf(leaf)
      const shown = shows(leaf, sel, 'Section 5')
      await wait(1800)
      out[m] = { saved, landed, later: scrollOf(leaf), peak: peak(), shows: shown, showsLater: shows(leaf, sel, 'Section 5') }
      leaf.detach()
      await wait(300)
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
    await wait(600)
    await view.engine.goTo(2)
    await wait(600)
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
    await wait(500)
    const out = {}
    for (const m of ['preview', 'source']) {
      app.vault.setConfig('defaultViewMode', m)
      const note = newLeaf()
      await note.openFile(file(path), { active: true })
      await wait(800)
      const saved = await scrollTo(note, 250)
      note.detach()
      await wait(300)
      app.workspace.setActiveLeaf(leaf, { focus: true })
      const peak = furthest(() => notesOf(path)[0])
      await view.reading.openNote(h)
      const nl = await until(() => notesOf(path)[0], 5000)
      await wait(600)
      const sel = m === 'preview' ? '.abele-line-flash, .callout' : '.abele-line-flash, .cm-line, .cm-callout'
      const landed = scrollOf(nl)
      const shown = shows(nl, sel, 'Chapter')
      await wait(1800)
      out[m] = { saved, landed, later: scrollOf(nl), peak: peak(), shows: shown, showsLater: shows(nl, sel, 'Chapter') }
      for (const l of notesOf(path)) l.detach()
      await wait(300)
    }
    return out
  `)

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
  await pause(1500)
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

  it('the deleted notes take their places with them', () => {
    const r = run<{ before: number; after: number }>(`
      const key = 'abele-note-places'
      const count = () => Object.keys(app.loadLocalStorage(key) ?? {}).filter((p) => p.startsWith(${JSON.stringify(DIR)})).length
      // Written a moment after a change; the unload of the plugin writes at once.
      await wait(2500)
      const before = count()
      const tmp = ${JSON.stringify(DIR)} + '/gone-sample.md'
      await app.vault.create(tmp, 'x')
      await app.vault.delete(file(tmp))
      await app.vault.delete(file(${JSON.stringify(OTHER)}))
      await app.vault.create(${JSON.stringify(OTHER)}, 'A short note.\\n')
      await app.vault.rename(file(${JSON.stringify(LONG)}), ${JSON.stringify(DIR)} + '/renamed-sample.md')
      await wait(2500)
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
  })
})
