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
import { driver, screenshot } from './helpers/phone'
import {
  nativeWebViewFrame,
  requireSelectionPoint,
  observeSelectionDelivery,
  dispatchSelectionHold,
  nativeCleanupPoint,
  type LiveSelectionObservation,
  type RectProof,
  type SelectionPointProof,
} from '../helpers/ref4ReleaseProof'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { buildLatvianEpub } from '../fixtures/books/latvianBook'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele reader selection place e2e'
const BOOK = `${DIR}/lv.epub`
const SHOTS = shotDir('abele-phone')
const nativeMenu = (source: string) =>
  /(?:Menu|MenuItem),|label: '(?:Copy|Look Up|Translate)'/.test(source)

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const observeDelivery = ${observeSelectionDelivery.toString()}
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
    if (onPhone()) {
      const boundary = evalJson<{
        folderAbsent: boolean
        leaves: number
        globalsAbsent: boolean
        readerRestored: boolean
      }>(`({
        folderAbsent:!app.vault.getAbstractFileByPath(${JSON.stringify(DIR)}),
        leaves:app.workspace.getLeavesOfType('abele-book').filter(l=>l.view.file?.path===${JSON.stringify(BOOK)}).length,
        globalsAbsent:!window.__abeleSelectionPlace&&!window.__abeleSelectionProbe,
        readerRestored:JSON.stringify(window.__abeleTest.AbeleConfig.getInstance().reader)===${JSON.stringify(JSON.stringify(savedReader))}
      })`)
      const menuPresent = nativeMenu(driver(['source']))
      writeFileSync(
        join(SHOTS, 'selection-final-boundary.json'),
        JSON.stringify({ ...boundary, nativeMenuPresent: menuPresent }, null, 2)
      )
      screenshot(`${SHOTS}/selection-place-final-boundary.png`)
      expect(
        { ...boundary, nativeMenuPresent: menuPresent },
        'ordinary teardown boundary before wrapper drop'
      ).toEqual({
        folderAbsent: true,
        leaves: 0,
        globalsAbsent: true,
        readerRestored: true,
        nativeMenuPresent: false,
      })
    }
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
    const build = process.env.ABELE_PHONE_BUILD
    if (!build) throw Error('native validation requires the assigned phone build')
    const expectedHash = createHash('sha256')
      .update(readFileSync(join(build, 'main.js')))
      .digest('hex')
    const identity = await run<{ hash: string; bytes: number; loaded: boolean; error?: string }>(`
      const bytes=await app.vault.adapter.readBinary('.obsidian/plugins/abele/main.js')
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')
      return JSON.stringify({hash,bytes:bytes.byteLength,loaded:!!app.plugins.plugins.abele?._loaded&&!!window.__abeleTest})
    `)
    writeFileSync(
      join(SHOTS, 'selection-runtime-identity.json'),
      JSON.stringify({ expectedHash, ...identity }, null, 2)
    )
    expect(identity.error).toBeUndefined()
    expect(identity.hash).toBe(expectedHash)
    expect(identity.loaded).toBe(true)
    const pick = await run<
      Omit<SelectionPointProof, 'nativeFrame' | 'liveSignature'> & {
        error?: string
        word: string
        wordRect: RectProof
      }
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
      const leaf=window.__abeleSelectionPlace, v=leaf.view
      const capture={leaf,expectedPath:${JSON.stringify(BOOK)},view:v,session:v.reading,engine:v.engine,renderer:v.engine.renderer,
        doc,frame:doc.defaultView.frameElement,frameWindow:doc.defaultView,text:w.text,paragraph:w.text.parentElement,
        word:w.word,start:w.start,end:w.end,local,css}
      window.__abeleSelectionProbe={doc,w,capture,events,dispose:() => handlers.forEach(([type,handler]) => doc.removeEventListener(type,handler,true))}
      return JSON.stringify({...owner(),...g,word:w.word,wordRect:rect(w.r),local,css,notices,
        expectedOwner:window.__abeleSelectionPlace.id,expectedPath:${JSON.stringify(BOOK)},signature:JSON.stringify(g),
        initialSelection:String(doc.getSelection()),caretHit:!!caret&&caret.startContainer===w.text&&caret.startOffset>=w.start&&caret.startOffset<=w.end,
        rootHit:!!hit&&(hit===view().engine||view().containerEl.contains(hit)),obstructed:notices.some(n=>n.intersects)})
    `)
    const evidence: Record<string, unknown> = {
      pick,
      actionCount: 0,
      identity,
      cleanupAction:
        'CLEANUP: one native tap on the owned public Clear the selection control; verify connected selection/menu, then ordinary owned-leaf teardown and boundary observation; no fallback or retry',
    }
    const save = () =>
      writeFileSync(join(SHOTS, 'selection-delivery.json'), JSON.stringify(evidence, null, 2))
    save()
    expect(pick.error).toBeUndefined()
    const nativeSource = driver(['source'])
    expect(nativeMenu(nativeSource), 'no pre-existing native selection menu').toBe(false)
    const nativeFrame = nativeWebViewFrame(nativeSource)
    const status = JSON.parse(driver(['status'])) as { screen?: unknown }
    evidence.screen = status.screen
    const point = requireSelectionPoint({ ...pick, nativeFrame, liveSignature: pick.signature })
    evidence.nativeFrame = nativeFrame
    evidence.nativePoint = point
    save()
    screenshot(`${SHOTS}/selection-place-before.png`)
    const deliverySource = driver(['source']),
      deliveryFrame = nativeWebViewFrame(deliverySource)
    evidence.nativeAtDelivery = { frame: deliveryFrame, menuPresent: nativeMenu(deliverySource) }
    save()
    expect(deliveryFrame, 'native frame did not change after capture').toEqual(nativeFrame)
    expect(nativeMenu(deliverySource), 'no native menu interposed before delivery').toBe(false)
    let held = false
    try {
      await dispatchSelectionHold(
        { ...pick, nativeFrame, liveSignature: pick.signature },
        async () => {
          const live = await run<LiveSelectionObservation>(
            `return JSON.stringify(observeDelivery(window.__abeleSelectionProbe.capture,app.workspace.activeLeaf,window))`
          )
          evidence.atDelivery = live
          return live
        },
        (point, live) => {
          evidence.atDelivery = live
          held = true
          evidence.actionCount = 1
          save()
          // Same ordinary driver route, but retain the explicit acknowledgement, not just exit 0.
          const reply = JSON.parse(driver(['longpress', String(point.x), String(point.y)])) as {
            ok?: boolean
          }
          evidence.nativeAcknowledgement = { ok: reply.ok }
          evidence.acknowledged = reply.ok === true
          save()
          expect(reply.ok, 'one native hold explicitly acknowledged').toBe(true)
        }
      )
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
    } catch (error) {
      evidence.primaryError = String(error)
      save()
      throw error
    } finally {
      if (held) {
        let cleanupError: string | undefined
        try {
          if (evidence.acknowledged === true) {
            const cleanupSource = driver(['source'])
            const cleanupFrame = nativeWebViewFrame(cleanupSource)
            const target = await run<{
              error?: string
              owned: boolean
              hit: boolean
              css: { x: number; y: number }
              visual: SelectionPointProof['visual']
              rect: RectProof
            }>(`
              const probe=window.__abeleSelectionProbe, live=observeDelivery(probe.capture,app.workspace.activeLeaf,window)
              const control=view().containerEl.querySelector('.abele-book-selection__actions svg.lucide-x')?.closest('.abele-obsidian-icon')
              if (!control || view().model.active || !view().model.selection) throw Error('owned public selection-dismiss control unavailable')
              const r=control.getBoundingClientRect(), css={x:r.left+r.width/2,y:r.top+r.height/2}, top=document.elementFromPoint(css.x,css.y)
              return JSON.stringify({owned:live.ready&&live.owner===${JSON.stringify(pick.owner)}&&live.path===${JSON.stringify(BOOK)}&&Object.values(live.identities).every(Boolean),
                hit:control.isConnected&&r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&(top===control||control.contains(top)),
                css,rect:rect(r),visual:geometry().visual})
            `)
            evidence.cleanupTarget = {
              ...target,
              nativeFrame: cleanupFrame,
              nativeMenuBefore: nativeMenu(cleanupSource),
            }
            save()
            expect(target.error).toBeUndefined()
            expect(target.owned, 'fresh exact owned cleanup session/document').toBe(true)
            expect(target.hit, 'public cleanup control is the actual unobstructed hit').toBe(true)
            const cleanupPoint = nativeCleanupPoint(target.css, target.visual, cleanupFrame)
            evidence.cleanupNativePoint = cleanupPoint
            evidence.cleanupActionCount = 1
            save()
            // Ordinary public control, only AFTER primary proof; never script a selection clear.
            const reply = JSON.parse(
              driver(['tap', String(cleanupPoint.x), String(cleanupPoint.y)])
            ) as { ok?: boolean }
            evidence.cleanupAcknowledgement = { ok: reply.ok }
            evidence.cleanupAcknowledged = reply.ok === true
            save()
            expect(reply.ok, 'one ordinary cleanup input explicitly acknowledged').toBe(true)
          } else
            evidence.cleanupStopped = 'hold acknowledgement unknown; no cleanup input or replay'
        } catch (error) {
          cleanupError = String(error)
        }
        // Both observations and assertions run even when the action or one cleanup fact fails.
        const cleanup = await run<{
          error?: string
          currentOwnedDocument: boolean
          empty: boolean
          toolbarAbsent: boolean
          modelEmpty: boolean
        }>(`
          const probe=window.__abeleSelectionProbe
          const current=()=>view()?.engine.renderer.getContents()[0]?.doc
          const owned=()=>app.workspace.activeLeaf===probe.capture.leaf&&view()===probe.capture.view&&view().file?.path===${JSON.stringify(BOOK)}&&
            view().reading===probe.capture.session&&current()===probe.capture.doc&&current().defaultView===probe.capture.frameWindow&&current().defaultView.frameElement===probe.capture.frame&&probe.capture.frame.isConnected
          const empty=!!await until(()=>owned()&&!String(current().getSelection()).trim()&&!view().model.selection&&!view().containerEl.querySelector('.abele-book-selection'),5000)
          const out={currentOwnedDocument:owned(),empty,toolbarAbsent:!view().containerEl.querySelector('.abele-book-selection'),modelEmpty:!view().model.selection}
          probe.dispose();delete window.__abeleSelectionProbe
          return JSON.stringify(out)
        `)
        let menuPresent: boolean | undefined, menuError: string | undefined
        try {
          menuPresent = nativeMenu(driver(['source']))
        } catch (error) {
          menuError = String(error)
        }
        evidence.cleanup = {
          ...cleanup,
          nativeMenuPresent: menuPresent,
          nativeMenuObservationError: menuError,
          actionError: cleanupError,
        }
        save()
        screenshot(`${SHOTS}/selection-place-cleanup.png`)
        expect
          .soft(cleanupError, 'ordinary cleanup input acknowledged without guessing/replay')
          .toBeUndefined()
        expect.soft(cleanup.error).toBeUndefined()
        expect
          .soft(
            cleanup.currentOwnedDocument,
            'selection absence belongs to the current connected owned document'
          )
          .toBe(true)
        expect.soft(cleanup.empty, 'owned native selection dismissed').toBe(true)
        expect.soft(cleanup.toolbarAbsent, 'owned selection toolbar dismissed').toBe(true)
        expect.soft(cleanup.modelEmpty).toBe(true)
        expect.soft(menuError, 'native menu independently observed').toBeUndefined()
        expect.soft(menuPresent, 'owned native menu dismissed before release').toBe(false)
      }
    }
  }, 120_000)
})
