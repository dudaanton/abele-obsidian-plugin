/** Folded history and viewport anchoring in the task timeline's real scroll owners. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const FOLDER = 'Sample timeline probe'
const SHOTS = shotDir('task-timeline')
const PHASE = process.env.TIMELINE_SHOT_PHASE ?? 'after'
interface Probe {
  error?: string
  initial?: string[]
  summary?: string
  revealed?: string[]
  countAfter?: string
  anchored?: number[]
  hiddenAnchor?: number[]
  futureAnchor?: number[]
  revealAnchor?: number[]
  lazy?: boolean
  sticky?: number
  overflow?: number
  shots?: string[]
}
const script = (footer: boolean) => String.raw`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const until = async fn => { for (let i = 0; i < 150; i++) { const v = fn(); if (v) return v; await wait(100) } throw Error('timeline did not become ready') }
  const folder = ${JSON.stringify(FOLDER)}
  const shots = ${JSON.stringify(SHOTS)}
  const phase = ${JSON.stringify(PHASE)}
  const pad = n => String(n).padStart(2, '0')
  const day = offset => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) }
  const report = { shots: [] }
  let leaf
  const config = window.__abeleTest.AbeleConfig.getInstance()
  const remembered = config.rememberNotePlaces
  config.rememberNotePlaces = false
  try {
    if (!app.vault.getAbstractFileByPath(folder)) {
      await app.vault.createFolder(folder)
      await app.vault.create(folder + '/Sample group.md', 'Sample group\n')
      const writes = []
      for (let d = -45; d <= 45; d++) {
        for (let n = 0; n < 3; n++) {
          const done = n === 0
          const title = 'Sample item ' + d + ' ' + n
          writes.push(app.vault.create(folder + '/' + title + '.md', '---\ntype: task\ndate: ' + day(d) + '\n' + (done ? 'completed: ' + day(d) + '\n' : '') + 'labels:\n  - sample-timeline-probe\ngroups:\n  - "[[' + folder + '/Sample group]]"\n---\n' + title + '\n'))
        }
      }
      // Much older completed-only days must never pull the reader to the start of history.
      for (let d = -90; d < -45; d++) writes.push(app.vault.create(folder + '/Sample archive ' + d + '.md', '---\ntype: task\ndate: ' + day(d) + '\ncompleted: ' + day(d) + '\nlabels:\n  - sample-timeline-probe\ngroups:\n  - "[[' + folder + '/Sample group]]"\n---\nSample archive ' + d + '\n'))
      await Promise.all(writes)
      await wait(3000)
    }
    leaf = app.workspace.getLeaf('tab')
    if (${footer}) {
      await leaf.setViewState({ type: 'markdown', state: { file: folder + '/Sample group.md', mode: 'source', source: false }, active: true })
      const s = await until(() => leaf.view.containerEl.querySelector('.cm-scroller'))
      await until(() => { s.scrollTop = s.scrollHeight; return leaf.view.containerEl.querySelector('.abele-timeline') })
    } else {
      await leaf.setViewState({ type: 'abele-timeline-sidebar-view', active: true })
    }
    app.workspace.setActiveLeaf(leaf, { focus: true })
    const root = await until(() => leaf.view.containerEl.querySelector('.abele-timeline'))
    if (!${footer}) {
      root.querySelector('.abele-task-label-filter').click()
      const option = await until(() => [...document.querySelectorAll('.menu-item')].find(x => x.textContent.includes('sample-timeline-probe')))
      option.click()
    }
    await wait(1200)
    const scroller = ${footer} ? leaf.view.containerEl.querySelector('.cm-scroller') : root.closest('.abele-timeline-sidebar')
    const blocks = () => [...root.querySelectorAll('.abele-timeline__date-block')]
    const dates = () => blocks().map(x => x.dataset.abeleAnchor)
    const strip = () => root.querySelector('.abele-timeline__history')
    const row = (d, n = 1) => [...root.querySelectorAll('.abele-task-view')].find(x => x.dataset.abeleAnchor === 'task:' + folder + '/Sample item ' + d + ' ' + n + '.md')
    const align = el => {
      // Model a reader's input before positioning, so a prior patch's temporary hold ends.
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }))
      scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 100
    }
    const shot = async name => {
      const path = shots + '/' + phase + '-' + (${footer} ? 'footer' : 'sidebar') + '-' + (app.isMobile ? 'phone' : 'desktop') + '-' + name + '.png'
      if (window.__e2eHost) await window.__e2eHost.shot(path)
      else {
        const fs = require('fs'); fs.mkdirSync(shots, { recursive: true })
        const wc = require('@electron/remote').getCurrentWebContents()
        const el = blocks().find(x => x.dataset.abeleAnchor === 'date:' + day(0))
        const r = el?.getBoundingClientRect()
        // Photograph the unchanged block at a fixed camera origin with its inherited theme
        // context. Fractional scroll offsets (and the editor's virtual transforms) otherwise
        // change text antialiasing without changing any styling or relative position.
        const camera = name === 'unchanged' && el ? el.cloneNode(true) : null
        let cameraContext = null
        if (camera) {
          camera.style.position = 'fixed'
          camera.style.left = Math.round(r.left) + 'px'
          camera.style.top = '200px'
          camera.style.width = r.width + 'px'
          camera.style.zIndex = '10000'
          camera.style.backgroundColor = 'var(--background-primary)'
          cameraContext = document.createElement('div')
          cameraContext.className = ${footer} ? 'abele-footer-view' : 'abele-timeline-sidebar'
          const inherited = getComputedStyle(el)
          for (const property of inherited) {
            if (property.startsWith('--') || ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'letter-spacing'].includes(property))
              cameraContext.style.setProperty(property, inherited.getPropertyValue(property))
          }
          cameraContext.style.pointerEvents = 'none'
          cameraContext.appendChild(camera)
          document.body.appendChild(cameraContext)
        }
        await wait(100)
        const cr = camera?.getBoundingClientRect()
        const rect = cr ? { x: Math.round(cr.left), y: Math.round(cr.top), width: Math.round(cr.width), height: Math.round(cr.height) } : undefined
        fs.writeFileSync(path, (await wc.capturePage(rect)).toPNG())
        cameraContext?.remove()
      }
      report.shots.push(path)
    }
    report.initial = dates()
    report.summary = strip()?.textContent.trim() ?? null
    // Bring today's unchanged block into sight even in the baseline (which starts in history).
    if (!row(0)) {
      for (let i = 0; i < 6 && !row(0); i++) { scroller.scrollTop = scroller.scrollHeight; await wait(700) }
    }
    await until(() => row(0))
    const todayBlock = blocks().find(x => x.dataset.abeleAnchor === 'date:' + day(0))
    scroller.scrollTop += todayBlock.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 200
    await wait(800)
    await shot('unchanged')
    await shot('initial')

    // Deliberately reach the upper boundary, then scroll upward once. No clicking the strip.
    const first = blocks()[0]
    scroller.scrollTop += first.getBoundingClientRect().top - scroller.getBoundingClientRect().top - (strip()?.getBoundingClientRect().height ?? 0)
    await wait(400)
    const beforeReveal = row(0).getBoundingClientRect().top
    if (window.__e2eHost) {
      const r = scroller.getBoundingClientRect()
      // Start in the scroll content, clear of the native floating navigation header.
      const y = r.top + Math.max(200, r.height * 0.45)
      await window.__e2eHost.swipe(r.left + r.width/2, y, r.left + r.width/2, y + 80)
    } else root.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -80 }))
    await wait(800)
    report.revealAnchor = [beforeReveal, row(0).getBoundingClientRect().top]
    report.revealed = dates()
    report.countAfter = strip()?.textContent.trim() ?? null
    // Keep the first incomplete row under the eye while completed rows appear above it.
    align(row(0)); await wait(500)
    const before = row(0).getBoundingClientRect().top
    root.querySelector('.abele-timeline__completed-toggle').click()
    await wait(1200)
    report.anchored = [before, row(0)?.getBoundingClientRect().top ?? -9999]
    report.lazy = !dates().includes('date:' + day(-90))
    // Pin the strip by reading further down the timeline, not while it is still in normal flow.
    const stickyScroll = scroller.scrollTop
    scroller.scrollTop += 400
    await wait(400)
    report.sticky = strip() ? Math.abs(strip().getBoundingClientRect().top - scroller.getBoundingClientRect().top) : 9999
    scroller.scrollTop = stickyScroll
    await wait(400)
    report.overflow = scroller.scrollWidth - scroller.clientWidth
    await shot('completed')
    const beforeHide = row(0)?.getBoundingClientRect().top ?? -9999
    root.querySelector('.abele-timeline__completed-toggle').click()
    await wait(1200)
    report.hiddenAnchor = [beforeHide, row(0)?.getBoundingClientRect().top ?? -9999]
    for (let i = 0; i < 4 && !row(25); i++) { scroller.scrollTop = scroller.scrollHeight; await wait(700) }
    await until(() => row(25))
    align(row(25)); await wait(1000)
    const futureBefore = row(25).getBoundingClientRect().top
    root.querySelector('.abele-timeline__completed-toggle').click()
    await wait(1200)
    report.futureAnchor = [futureBefore, row(25)?.getBoundingClientRect().top ?? -9999]
  } catch (e) { report.error = String(e && e.stack || e) }
  finally { leaf?.detach(); config.rememberNotePlaces = remembered }
  return JSON.stringify(report)
})()`

describe.skipIf(!available)('task timeline scrolling', () => {
  let desktop: Probe[] = [],
    mobile: Probe[] = []
  let state: { size: number[]; layout: unknown } | null = null
  beforeAll(async () => {
    state = JSON.parse(
      evalRaw(
        `JSON.stringify({ size: window.__e2eHost ? [] : require('@electron/remote').getCurrentWindow().getContentSize(), layout: app.workspace.getLayout() })`
      )
    )
    if (!onPhone()) {
      for (const footer of [false, true])
        desktop.push(JSON.parse(await evalLong(script(footer), 100000)))
      await reloadApp('app.emulateMobile(true)')
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844); 'sized'`)
      await reloadApp('window.location.reload()')
    }
    for (const footer of [false, true])
      mobile.push(JSON.parse(await evalLong(script(footer), 100000)))
    console.info(JSON.stringify({ desktop, mobile }))
  }, 360000)
  afterAll(async () => {
    if (!available) return
    evalRaw(
      `(async () => { const f = app.vault.getAbstractFileByPath(${JSON.stringify(FOLDER)}); if (f) await app.vault.delete(f, true); return 'removed' })()`,
      60000
    )
    if (state) {
      if (!onPhone()) {
        evalRaw(
          `require('@electron/remote').getCurrentWindow().setContentSize(${state.size.join(',')}); 'restored'`
        )
        await reloadApp('app.emulateMobile(false)')
      }
      evalRaw(
        `(async () => { await app.workspace.changeLayout(${JSON.stringify(state.layout)}); return 'restored' })()`,
        60000
      )
    }
  }, 120000)
  for (const kind of ['desktop', 'phone width']) {
    for (const [index, owner] of ['sidebar', 'note footer'].entries()) {
      const probe = () => (kind === 'desktop' ? desktop : mobile)[index]
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: starts today, reveals only one past day, shrinks the sticky summary`,
        () => {
          const p = probe()
          expect(p.error).toBeUndefined()
          expect(p.initial).toHaveLength(20)
          expect(p.summary).toContain('90 unfinished')
          expect(p.revealed).toHaveLength(21)
          expect(p.countAfter).toContain('88 unfinished')
          expect(p.sticky).toBeLessThanOrEqual(2)
          expect(p.overflow).toBeLessThanOrEqual(1)
          if (!onPhone()) {
            expect(p.revealAnchor).toHaveLength(2)
            expect(Math.abs(p.revealAnchor![1] - p.revealAnchor![0] - 80)).toBeLessThanOrEqual(2)
          }
        }
      )
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: completed toggles hold the same row within two pixels without loading old history`,
        () => {
          const p = probe()
          expect(p.error).toBeUndefined()
          expect(p.lazy).toBe(true)
          for (const pair of [p.anchored, p.hiddenAnchor, p.futureAnchor]) {
            expect(pair).toHaveLength(2)
            expect(Math.abs(pair![1] - pair![0])).toBeLessThanOrEqual(2)
          }
        }
      )
    }
  }
})
