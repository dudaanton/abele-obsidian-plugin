/**
 * A word selected in a book is selected where it is drawn, in the running app: a justified book
 * set in a monospace font, on the desktop and on a real iPhone.
 *
 * iOS WebKit (iOS 26) draws a justified line in a monospace font stretched across the column,
 * and hit-tests it that way too, but on the paragraph's first layout it answers where the words
 * are — `Range.getClientRects`, the selection it paints, the highlights measured from it — as if
 * the line were not stretched. A word long-pressed was selected, with its selection painted over
 * the words to its left; every highlight sat a few letters off. Changing any font property of the
 * text puts it right, which is what switching the reader's font did.
 *
 * So for every word on the page the point in the middle of its measured box must hit that word
 * — after the page has settled, and again after the page's style changed — and on the phone a
 * real long press in the middle of a word must select that word, its selection box where the
 * word's box is. The picture of it goes to `/tmp/abele-phone/selection-place-held.png`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalLong, evalRaw, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { driver, longPress, screenshot, tap } from './helpers/phone'
import {
  nativeWebViewFrame,
  requireSelectionPoint,
  type SelectionPointProof,
} from '../helpers/ref4ReleaseProof'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildLatvianEpub } from '../fixtures/books/latvianBook'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader selection place e2e'
const BOOK = `${DIR}/lv.epub`
const SHOTS = shotDir('abele-phone')

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const cfg = window.__abeleTest.AbeleConfig.getInstance()
  const setReader = async (patch) => { cfg.reader = { ...cfg.reader, ...patch }; await cfg.saveSettings() }
  const view = () => window.__abeleSelectionPlace?.view
  const contents = () => view().engine.renderer.getContents()[0]
  const openBook = async () => {
    let leaf
    try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
    await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
    const v = await until(() => leaf.view?.model?.status === 'ready' && leaf.view.reading && leaf.view)
    if (v.model.panel) { v.model.panel = false; await wait(400) }
    // This test owns this book only; other supported book panes stay intact.
    window.__abeleSelectionPlace = leaf
    return v
  }
  const rect = r => ({ x:r.x,y:r.y,width:r.width,height:r.height })
  const geometry = () => {
    const frame=contents().doc.defaultView.frameElement, vv=visualViewport
    return { iframe:rect(frame.getBoundingClientRect()),border:{x:frame.clientLeft,y:frame.clientTop},
      scale:{x:frame.getBoundingClientRect().width/frame.offsetWidth,y:frame.getBoundingClientRect().height/frame.offsetHeight},
      viewport:{width:innerWidth,height:innerHeight},visual:{width:vv.width,height:vv.height,offsetLeft:vv.offsetLeft,offsetTop:vv.offsetTop},
      visualScale:vv.scale,transform:getComputedStyle(frame).transform,reader:rect(view().engine.renderer.getBoundingClientRect()) }
  }
  const signature = () => JSON.stringify([window.__abeleSelectionPlace.id,view().file?.path,geometry()])
  const owner = () => ({owner:app.workspace.activeLeaf?.id,path:app.workspace.activeLeaf?.view.file?.path,
    ready:app.workspace.activeLeaf===window.__abeleSelectionPlace && view().model.status==='ready' && !!view().reading && view().containerEl.isConnected})
  /** Every whole word on the page shown, with its measured box in the page's coordinates. */
  const wordsShown = () => {
    const doc = contents().doc
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const page = view().engine.renderer.getBoundingClientRect()
    const out = []
    for (const p of doc.querySelectorAll('p')) {
      const text = p.firstChild
      if (!text || text.nodeType !== 3) continue
      const re = /\\S+/g
      let m
      while ((m = re.exec(text.data))) {
        const range = doc.createRange()
        range.setStart(text, m.index); range.setEnd(text, m.index + m[0].length)
        const rects = [...range.getClientRects()]
        if (rects.length !== 1) continue
        const r = rects[0]
        const x = r.left + frame.left, y = r.top + frame.top
        if (x < page.left || x + r.width > page.right || y < page.top || y + r.height > page.bottom) continue
        out.push({ word: m[0], text, start: m.index, end: m.index + m[0].length, r, x, y })
      }
    }
    return out
  }
  /** The words whose measured box, hit in its middle, answers with another place in the text. */
  const misplaced = () => {
    const doc = contents().doc
    const words = wordsShown()
    const wrong = []
    for (const w of words) {
      const hit = doc.caretRangeFromPoint(w.r.left + w.r.width / 2, w.r.top + w.r.height / 2)
      const ok = hit && hit.startContainer === w.text && hit.startOffset >= w.start && hit.startOffset <= w.end
      if (!ok) {
        const t = hit?.startContainer?.data ?? ''
        const at = hit?.startOffset ?? 0
        wrong.push(w.word + ' -> ' + t.slice(Math.max(0, at - 6), at) + '|' + t.slice(at, at + 6))
      }
    }
    return { words: words.length, wrong }
  }
`

const run = async <T>(body: string): Promise<T> => {
  const out = await evalLong(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return JSON.stringify({ error: String((e && e.stack) || e) }) }
    })()`,
    120_000
  )
  try {
    return JSON.parse(out) as T
  } catch {
    throw new Error(`Not JSON from the app: ${out.slice(0, 400)}`)
  }
}

interface Placed {
  error?: string
  words: number
  wrong: string[]
}

describe.skipIf(!available)('a word is selected where it is drawn', () => {
  let savedReader: unknown = null

  beforeAll(() => {
    savedReader = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().reader')
    const data = Buffer.from(buildLatvianEpub()).toString('base64')
    evalRaw(
      `(async () => {
        if (window.__abeleSelectionPlace || window.__abeleSelectionProbe) throw Error('selection fixture global already occupied')
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(data)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = { ...cfg.reader, placesPath:${JSON.stringify(DIR + '/sample-places.json')}, flow: 'paginated', columns: 1, font: 'book', bookStyles: true, fontSize: 100, lineHeight: 1.5 }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        window.__abeleSelectionProbe?.dispose()
        delete window.__abeleSelectionProbe
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) if (leaf.view.file?.path === ${JSON.stringify(BOOK)}) leaf.detach()
        delete window.__abeleSelectionPlace
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.reader = ${JSON.stringify(savedReader)}
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('measures every word where a touch finds it, once the page has settled', async () => {
    const r = await run<Placed>(`
      await openBook()
      await wait(2500)
      return JSON.stringify(misplaced())
    `)
    expect(r.error).toBeUndefined()
    expect(r.words, 'words on the page').toBeGreaterThan(40)
    expect(r.wrong, 'words measured away from where they are hit').toEqual([])
  }, 120_000)

  it('still does after the page style changed', async () => {
    const r = await run<Placed>(`
      if (!view()) await openBook()
      await setReader({ lineHeight: 1.6 })
      await wait(2000)
      await setReader({ lineHeight: 1.5 })
      await wait(2000)
      return JSON.stringify(misplaced())
    `)
    expect(r.error).toBeUndefined()
    expect(r.words, 'words on the page').toBeGreaterThan(40)
    expect(r.wrong, 'words measured away from where they are hit').toEqual([])
  }, 120_000)

  it('selects the word a finger holds, with its selection over that word (phone)', async () => {
    if (!onPhone()) return
    const pick = await run<
      Omit<SelectionPointProof, 'nativeFrame' | 'liveSignature'> & { error?: string; word: string }
    >(`
      if (!view()) { await openBook(); await wait(2500) }
      // A word whose measured middle a touch finds inside another word, if the page has one:
      // there a finger held on the measure selects the wrong word. Otherwise the word before the
      // last on a line of few words, the line stretched most and the word furthest along it.
      const doc = contents().doc
      const words = wordsShown()
      const inOther = words.find((w) => {
        const hit = doc.caretRangeFromPoint(w.r.left + w.r.width / 2, w.r.top + w.r.height / 2)
        if (!hit || hit.startContainer.nodeType !== 3) return false
        const t = hit.startContainer.data, at = hit.startOffset
        const inside = at > 0 && at < t.length && /\\S/.test(t[at - 1]) && /\\S/.test(t[at])
        return inside && !(hit.startContainer === w.text && at >= w.start && at <= w.end)
      })
      const lines = []
      for (const w of words) {
        const line = lines.find((l) => Math.abs(l[0].y - w.y) < 2)
        if (line) line.push(w)
        else lines.push([w])
      }
      const line = lines.filter((l) => l.length >= 4).sort((a, b) => a.length - b.length)[0]
      const w = inOther ?? line?.[line.length - 2]
      if (!w) return JSON.stringify({ error: 'no word to hold' })
      const g=geometry(), local={x:w.r.left+w.r.width/2,y:w.r.top+w.r.height/2}
      const css={x:g.iframe.x+(g.border.x+local.x)*g.scale.x,y:g.iframe.y+(g.border.y+local.y)*g.scale.y}
      const caret=doc.caretRangeFromPoint(local.x,local.y), hit=document.elementFromPoint(css.x,css.y)
      const notices=[...document.querySelectorAll('.notice')].map(el => { const r=el.getBoundingClientRect();return {rect:rect(r),intersects:css.x>=r.left&&css.x<=r.right&&css.y>=r.top&&css.y<=r.bottom} })
      const events=[], handlers=[]
      for (const type of ['pointerdown','pointerup','touchstart','touchend','selectionchange']) {
        const handler=e => {
          const t=e.touches?.[0]??e.changedTouches?.[0]??e, el=e.target?.nodeType===1?e.target:e.target?.parentElement
          const item={type:e.type,trusted:e.isTrusted,x:t.clientX,y:t.clientY,target:el?.tagName,id:el?.id,
            wordTarget:el===w.text.parentElement,wordHit:t.clientX>=w.r.left&&t.clientX<=w.r.right&&t.clientY>=w.r.top&&t.clientY<=w.r.bottom,
            defaultPrevented:e.defaultPrevented,selected:String(doc.getSelection()).trim()}
          events.push(item);queueMicrotask(() => item.defaultPreventedAfter=e.defaultPrevented)
        }
        doc.addEventListener(type,handler,true);handlers.push([type,handler])
      }
      window.__abeleSelectionProbe={doc,w,events,dispose:() => handlers.forEach(([type,handler]) => doc.removeEventListener(type,handler,true))}
      return JSON.stringify({...owner(),...g,word:w.word,wordRect:rect(w.r),local,css,notices,
        expectedOwner:window.__abeleSelectionPlace.id,expectedPath:${JSON.stringify(BOOK)},signature:signature(),
        initialSelection:String(doc.getSelection()),caretHit:!!caret&&caret.startContainer===w.text&&caret.startOffset>=w.start&&caret.startOffset<=w.end,
        rootHit:!!hit&&(hit===view().engine||view().containerEl.contains(hit)),obstructed:notices.some(n=>n.intersects)})
    `)
    const evidence: Record<string, unknown> = {
      pick,
      actionCount: 0,
      cleanupAction: 'one ordinary tap at the held word after result capture',
    }
    const save = () =>
      writeFileSync(join(SHOTS, 'selection-delivery.json'), JSON.stringify(evidence, null, 2))
    save()
    expect(pick.error).toBeUndefined()
    const nativeMenu = (source: string) =>
      /(?:Menu|MenuItem),|label: '(?:Copy|Look Up|Translate)'/.test(source)
    const nativeSource = driver(['source'])
    expect(nativeMenu(nativeSource), 'no pre-existing native selection menu').toBe(false)
    const nativeFrame = nativeWebViewFrame(nativeSource)
    const status = JSON.parse(driver(['status'])) as { screen?: unknown }
    evidence.screen = status.screen
    const live = await run<{ signature: string; error?: string }>(
      `return JSON.stringify({signature:signature()})`
    )
    const point = requireSelectionPoint({ ...pick, nativeFrame, liveSignature: live.signature })
    evidence.nativeFrame = nativeFrame
    evidence.nativePoint = point
    save()
    screenshot(`${SHOTS}/selection-place-before.png`)
    const atDelivery = await run<{ signature: string }>(
      `return JSON.stringify({signature:signature()})`
    )
    requireSelectionPoint({ ...pick, nativeFrame, liveSignature: atDelivery.signature })
    let held = false
    try {
      held = true
      evidence.actionCount = 1
      save()
      longPress(point.x, point.y) // Exactly one attempt; a missing acknowledgement is never replayed.
      evidence.acknowledged = true
      screenshot(`${SHOTS}/selection-place-held.png`)
      const r = await run<{
        error?: string
        selected: string
        dx: number
        unroundedDx: number
        events: { type: string; trusted: boolean; wordTarget: boolean; wordHit: boolean }[]
      }>(`
        const probe=window.__abeleSelectionProbe, sel=probe.doc.getSelection()
        await until(() => sel.rangeCount&&String(sel).trim(),5000)
        const box=sel.rangeCount?sel.getRangeAt(0).getClientRects()[0]:null
        const range=probe.doc.createRange();range.setStart(probe.w.text,probe.w.start);range.setEnd(probe.w.text,probe.w.end)
        const word=range.getClientRects()[0], dx=box&&word?Math.abs(box.left-word.left):null
        return JSON.stringify({selected:String(sel).trim(),dx:dx===null?null:Math.round(dx),unroundedDx:dx,
          selectionRect:box&&rect(box),wordRect:word&&rect(word),geometry:geometry(),events:probe.events,
          notices:[...document.querySelectorAll('.notice')].map(el=>rect(el.getBoundingClientRect()))})
      `)
      evidence.result = r
      evidence.nativeMenuAfterHold = nativeMenu(driver(['source']))
      save()
      expect(r.error).toBeUndefined()
      expect(
        r.events.some((e) => e.type === 'pointerdown' && e.trusted && e.wordTarget && e.wordHit),
        'trusted input delivered to held paragraph'
      ).toBe(true)
      expect(
        r.events.some((e) => e.type === 'touchstart' && e.trusted && e.wordTarget && e.wordHit),
        'trusted touch delivered to held paragraph'
      ).toBe(true)
      expect(
        r.events.some((e) => e.type === 'selectionchange' && e.trusted),
        'native selection change observed'
      ).toBe(true)
      expect(r.selected, 'the word held').toBe(pick.word)
      expect(r.dx, 'the selection box starts where the word does').toBeLessThanOrEqual(1)
      expect(r.unroundedDx).toBeGreaterThanOrEqual(0)
      expect(r.unroundedDx).toBeLessThanOrEqual(1)
    } finally {
      if (held) {
        const boundary = await run<{ ready: boolean; owner: string; signature: string }>(
          `return JSON.stringify({...owner(),signature:signature()})`
        )
        evidence.preCleanup = boundary
        save()
        expect(boundary.ready, 'owned selection cleanup target remains ready').toBe(true)
        expect(boundary.owner, 'no guessed cleanup owner').toBe(pick.owner)
        expect(boundary.signature, 'no guessed cleanup point').toBe(pick.signature)
        // Public native tap only AFTER the result was captured. Never script a selection clear.
        tap(point.x, point.y)
        const cleanup = await run<{ empty: boolean }>(`
          const doc=window.__abeleSelectionProbe.doc
          const empty=!!await until(() => !String(doc.getSelection()).trim(),5000)
          window.__abeleSelectionProbe.dispose();delete window.__abeleSelectionProbe
          return JSON.stringify({empty})
        `)
        evidence.cleanup = { ...cleanup, nativeMenuPresent: nativeMenu(driver(['source'])) }
        save()
        screenshot(`${SHOTS}/selection-place-cleanup.png`)
        expect(cleanup.empty, 'owned native selection dismissed').toBe(true)
        expect(
          (evidence.cleanup as { nativeMenuPresent: boolean }).nativeMenuPresent,
          'owned native menu dismissed before release'
        ).toBe(false)
      }
    }
  }, 120_000)
})
