/**
 * The overdue and past-days folds, the pinned header and viewport anchoring in the task
 * timeline's real scroll owners.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  enterPhone,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { timelineStyleReference } from './helpers/timelineStyleReference'
import { PIXEL_PROBE } from './helpers/stablePixels'
import { TIMELINE_POSITION_PROBE } from './helpers/timelinePosition'
import { TIMELINE_FIXTURE_PROBE } from './helpers/timelineFixture'
import { TIMELINE_READY_PROBE } from './helpers/timelineReady'
import { timelineStructuralCss } from './contracts/timelineStructuralCss'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const FOLDER = 'Sample timeline probe'
const SHOTS = shotDir('task-timeline')
const PHASE = process.env.TIMELINE_SHOT_PHASE ?? 'after'
let comparisonCss = ''
interface Probe {
  error?: string
  initial?: string[]
  summary?: string
  revealed?: string[]
  revealedOverdue?: string[]
  overdueRowsDone?: number
  overdueRows?: number
  daysBeforeReveal?: string[]
  daysAfterReveal?: string[]
  pastHidden?: boolean
  pastDays?: string[]
  pastRows?: number
  pastRowsOpen?: number
  pastAnchor?: number[]
  pastShownAnchor?: number[]
  pastCollapseAnchor?: number[]
  overdueCollapseAnchor?: number[]
  counts?: [string, number, number][]
  overlaps?: string[]
  hoverChecked?: number
  pinnedFar?: number
  pinnedHit?: boolean
  pinnedGround?: string
  countAfter?: string
  anchored?: number[]
  hiddenAnchor?: number[]
  futureAnchor?: number[]
  revealAnchor?: number[]
  collapseAnchor?: number[]
  rerevealAnchor?: number[]
  removedPastAnchor?: number[]
  collapsed?: string[]
  collapseSummary?: string
  restoredCollapsed?: boolean
  scrollRevealed?: string[]
  nativeInput?: boolean
  nativeScroll?: number[]
  nativeDistance?: number
  nativeSettled?: number
  pastCompleted?: boolean
  appearancePixels?: number
  appearanceCoordinates?: { x: number; y: number; before: number[]; after: number[] }[]
  appearanceRaster?: { pixelWidth: number; crop: number[]; devicePixelRatio: number }[]
  appearanceCanary?: number
  appearancePositionCanary?: number[][]
  appearanceRects?: number[][]
  emptySpace?: number
  restoredHistory?: boolean
  restoredAnchor?: number[]
  allHistory?: boolean
  sticky?: number
  chromeGap?: number
  calendarGap?: number
  calendarLayout?: unknown
  overflow?: number
  shots?: string[]
}
const script = (footer: boolean, short = false) => String.raw`(async function* () {
  ${PIXEL_PROBE}
  ${TIMELINE_POSITION_PROBE}
  const wait = ms => new Promise(r => setTimeout(r, ms))
  let uiState = () => null
  const until = async (fn, condition = 'timeline UI') => { for (let i = 0; i < 300; i++) { const v = fn(); if (v) return v; await wait(50) } throw Error('timeline did not become ready: ' + condition + '; state=' + JSON.stringify(uiState())) }
  ${TIMELINE_FIXTURE_PROBE}
  ${TIMELINE_READY_PROBE}
  const folder = ${JSON.stringify(FOLDER)} + (${short} ? ' short' : '')
  const label = 'sample-timeline-probe' + (${short} ? '-short' : '')
  const shots = ${JSON.stringify(SHOTS)}
  const phase = ${JSON.stringify(PHASE)}
  const pad = n => String(n).padStart(2, '0')
  const day = offset => { const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) }
  const report = { shots: [] }
  let leaf
  const config = window.__abeleTest.AbeleConfig.getInstance()
  const remembered = config.rememberNotePlaces
  const renders = observeTimelineMarkdown(window.__abeleTest.rendering.MarkdownRenderer)
  try {
    config.rememberNotePlaces = false
    yield 'fixture creation'
    if (!app.vault.getAbstractFileByPath(folder)) {
      await app.vault.createFolder(folder)
      await app.vault.create(folder + '/Sample group.md', 'Sample group\n')
      let writes = []
      for (let d = ${short ? -1 : -45}; d <= ${short ? 0 : 45}; d++) {
        for (let n = 0; n < 3; n++) {
          const done = n === 0
          const title = 'Sample item ' + d + ' ' + n
          writes.push(() => createTask(folder + '/' + title + '.md', '---\ntype: task\ndate: ' + day(d) + '\n' + (${short} && done ? 'dateTime: 08:00\n' : '') + (done ? 'completed: ' + day(d) + '\n' : '') + 'labels:\n  - ' + label + '\ngroups:\n  - "[[' + folder + '/Sample group]]"\n---\n' + title + '\n'))
        }
        // Native vault writes are serialized by the device. Bound each phase instead of
        // charging hundreds of writes to the interaction probe's one deadline.
        if (writes.length >= 24) {
          await writeBatch(writes); writes = []
          yield 'fixture tasks through offset ' + d
        }
      }
      // Much older completed-only days must never pull the reader to the start of history.
      for (let d = -90; d < -45; d++) {
        writes.push(() => createTask(folder + '/Sample archive ' + d + '.md', '---\ntype: task\ndate: ' + day(d) + '\ncompleted: ' + day(d) + '\nlabels:\n  - ' + label + '\ngroups:\n  - "[[' + folder + '/Sample group]]"\n---\nSample archive ' + d + '\n'))
        if (writes.length >= 24) {
          await writeBatch(writes); writes = []
          yield 'fixture archives through offset ' + d
        }
      }
      await writeBatch(writes)
    }
    yield 'waiting for every fixture task in the resolved metadata store'
    const expectedTasks = ${short ? 51 : 318}
    const metadataDeadline = Date.now() + 60000
    let loadedTasks = 0
    while (Date.now() < metadataDeadline) {
      loadedTasks = [...window.__abeleTest.GlobalStore.getInstance().tasksList.value.tasks.values()]
        .filter(task => task.taskPath.startsWith(folder + '/') && task.loaded && task.dates.length).length
      if (loadedTasks === expectedTasks) break
      await wait(100)
    }
    if (loadedTasks !== expectedTasks) {
      const tasks = window.__abeleTest.GlobalStore.getInstance().tasksList.value.tasks
      const missing = app.vault.getMarkdownFiles().filter(file => file.path.startsWith(folder + '/') &&
        app.metadataCache.getFileCache(file)?.frontmatter?.type === 'task' && !tasks.get(file.path)?.dates.length)
        .map(file => ({path:file.path,cache:app.metadataCache.getFileCache(file)?.frontmatter,stored:tasks.has(file.path)}))
      throw Error('fixture metadata: ' + loadedTasks + '/' + expectedTasks + ' tasks ready; missing: ' + JSON.stringify(missing))
    }
    yield 'opening scroll owner and waiting for timeline'
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
      const option = await until(() => [...document.querySelectorAll('.menu-item')].find(x => x.querySelector('.menu-item-title')?.textContent.trim().startsWith(label + ' (')))
      option.click()
    }
    const scroller = ${footer} ? leaf.view.containerEl.querySelector('.cm-scroller') : root.closest('.abele-timeline-sidebar')
    const blocks = () => [...root.querySelectorAll('.abele-timeline__date-block')]
    const dates = () => blocks().map(x => x.dataset.abeleAnchor)
    // Two folds above today: what was left undone, and the days gone by with what was done.
    const overdueRow = () => root.querySelector('.abele-timeline__overdue')
    const pastRow = () => root.querySelector('.abele-timeline__history')
    const pinned = () => root.querySelector('.abele-timeline__pinned')
    const foldState = el => el ? [el.querySelector('.abele-timeline__overdue-count')?.getAttribute('aria-label'), el.getAttribute('aria-label')].join(' · ') : null
    const groupDays = id => blocks().filter(x => x.dataset.timelineGroup === id).map(x => x.dataset.abeleAnchor)
    const groupRows = id => [...root.querySelectorAll('.abele-timeline__date-block[data-timeline-group="' + id + '"] [data-timeline-item^="task:"]')]
    const store = window.__abeleTest.GlobalStore.getInstance().tasksList.value.tasks
    const done = el => {
      const path = (el.dataset.abeleAnchor ?? el.querySelector('[data-abele-anchor]')?.dataset.abeleAnchor ?? '').replace(/^task:/, '')
      const task = store.get(path)
      if (!task) throw Error('timeline row without a stored task: ' + path)
      return !!task.completedAt
    }
    // The heading's number against the tasks the list draws now: each task once, whatever days it spans.
    const headerCount = () => Number(pinned()?.querySelector('.abele-fold-heading__count, .abele-list-section-header__count')?.textContent.trim())
    const openTasks = () => new Set([...root.querySelectorAll('[data-timeline-item^="task:"]')].map(x => x.dataset.timelineItem)).size
    const count = state => (report.counts ??= []).push([state, headerCount(), openTasks()])
    uiState = () => ({today:day(0),dates:dates(),overdue:overdueRow()?.textContent.trim(),past:pastRow()?.textContent.trim(),
      viewport:[scroller.clientWidth,scroller.clientHeight],label,
      fixtureDates:[...window.__abeleTest.GlobalStore.getInstance().tasksList.value.tasks.values()]
        .filter(task=>task.taskPath.startsWith(folder+'/')&&!task.completedAt)
        .reduce((counts,task)=>{const key=task.date?.format('YYYY-MM-DD')??'none';counts[key]=(counts[key]??0)+1;return counts},{})})
    const settleUI = async (expected = () => true, timeline = root, owner = scroller) => {
      const chrome = () => {
        const sidebar = timeline.closest('.abele-timeline-sidebar')
        const header = leaf.view.containerEl.querySelector('.view-header')
        return sidebar ? [sidebar.querySelector('.abele-calendar'), header] : [header]
      }
      const frame = () => new Promise(done => owner.ownerDocument.defaultView.requestAnimationFrame(done))
      await settleTimelineView(timeline, owner, expected, renders, chrome, frame)
    }
    const toggleCompleted = async () => {
      const control = root.querySelector('.abele-timeline__completed-toggle')
      const before = control.getAttribute('aria-checked')
      if (before !== 'true' && before !== 'false') throw Error('completed switch state missing')
      control.click()
      await settleUI(() => control.getAttribute('aria-checked') === String(before !== 'true'))
    }
    const foldClick = async (fold) => {
      const el = fold()
      if (!el) throw Error('fold row missing; state=' + JSON.stringify(uiState()))
      const expanded = el.getAttribute('aria-expanded')
      if (window.__e2eHost) {
        const r = el.getBoundingClientRect()
        let point
        for (const fy of [0.5, 0.75, 0.25]) for (const fx of [0.5, 0.75, 0.25]) {
          const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy)
          const hit = document.elementFromPoint(x, y)
          if (y >= chromeBottom() && hit && el.contains(hit)) point ??= {x, y}
        }
        if (!point) throw Error('fold row has no hittable point: ' + JSON.stringify({box:r.toJSON(),chrome:chromeBottom()}))
        const {x, y} = point
        const received = []
        const record = e => received.push({ type: e.type, target: e.target.className, prevented: e.defaultPrevented })
        for (const type of ['touchstart', 'touchend', 'click']) document.addEventListener(type, record, true)
        try {
          await window.__e2eHost.tap(x, y)
          // The tap's own toggle, bounded by the former 200 ms allowance.
          for (let t = 0; t < 20 && el.isConnected && el.getAttribute('aria-expanded') === expanded; t++) await wait(10)
          if (!el.isConnected || el.getAttribute('aria-expanded') === expanded) throw Error('Fold row tap did not toggle it: ' + JSON.stringify({ x, y, hit: document.elementFromPoint(x, y)?.className, received }))
        } finally {
          for (const type of ['touchstart', 'touchend', 'click']) document.removeEventListener(type, record, true)
        }
      } else el.click()
      await until(() => fold()?.getAttribute('aria-expanded') !== expanded, 'fold toggled')
    }
    // Fold rows, days and the pinned header never cover one another, hovered or not.
    const intersections = (state) => {
      const boxes = [['pinned', pinned()], ['overdue', overdueRow()], ['past', pastRow()],
        ...blocks().map(x => [x.dataset.timelineGroup + ' ' + x.dataset.abeleAnchor, x])]
        .filter(([, el]) => el).map(([name, el]) => [name, el.getBoundingClientRect()])
        .filter(([, r]) => r.height > 0)
      const top = usableTop(), bottom = scroller.getBoundingClientRect().bottom
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const [a, ra] = boxes[i], [b, rb] = boxes[j]
        // The days scroll under the pinned header by design; it is opaque. Elsewhere, nothing overlaps.
        if (a === 'pinned') continue
        if (Math.max(ra.top, rb.top) < top || Math.min(ra.bottom, rb.bottom) > bottom) continue
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left)
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top)
        if (w > 0.5 && h > 0.5) (report.overlaps ??= []).push(state + ': ' + a + ' × ' + b + ' ' + JSON.stringify([ra.toJSON(), rb.toJSON()]))
      }
    }
    // A real pointer over a fold row, then over the first day's first row, on a desktop.
    const hoverCheck = async (state) => {
      intersections(state)
      if (window.__e2eHost) return
      const cdp = require('@electron/remote').getCurrentWebContents().debugger
      for (const el of [overdueRow(), pastRow(), root.querySelector('[data-timeline-item^="task:"]')]) {
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.top < usableTop() || r.bottom > scroller.getBoundingClientRect().bottom) continue
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2)
        await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        const hit = document.elementFromPoint(x, y)
        if (!hit || !el.contains(hit)) (report.overlaps ??= []).push(state + ': hovered row covered by ' + hit?.className)
        intersections(state + ' hover')
        report.hoverChecked = (report.hoverChecked ?? 0) + 1
      }
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
    }
    const row = (d, n = 1) => [...root.querySelectorAll('.abele-task-view')].find(x => x.dataset.abeleAnchor === 'task:' + folder + '/Sample item ' + d + ' ' + n + '.md')
    const chromeBottom = () => {
      if (!document.body.classList.contains('is-phone')) return 0
      const bodyStyle = getComputedStyle(document.body)
      const safe = parseFloat(bodyStyle.getPropertyValue('--safe-area-inset-top')) || 0
      const nativeHeader = parseFloat(bodyStyle.getPropertyValue('--view-header-height')) || 0
      const viewport = scroller.getBoundingClientRect()
      return Math.max(safe + nativeHeader, ...[...document.querySelectorAll('.view-header')].flatMap(header =>
        [header, ...header.querySelectorAll('*')].map(el => {
          const r = el.getBoundingClientRect()
          return r.width && r.height && r.right > viewport.left && r.left < viewport.right &&
            r.bottom > viewport.top && r.top < viewport.bottom ? r.bottom : 0
        })
      ))
    }
    const usableTop = () => {
      const viewport = scroller.getBoundingClientRect().top
      if (!document.body.classList.contains('is-phone')) return viewport
      return Math.max(viewport, chromeBottom())
    }
    const align = async el => {
      // Entering a paged region paints lazy titles after its first scroll frame. Position
      // the intended first read row through that settling, not a lower row that drifted
      // below newly painted predecessors before the completed toggle even began.
      const displacement = () => {
        if (!el.isConnected) throw Error('timeline fixture row was replaced while positioning')
        return el.getBoundingClientRect().top - usableTop() - (pinned()?.getBoundingClientRect().height ?? 0) - 8
      }
      await settleTimelinePosition(displacement, () => {
        scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }))
        scroller.scrollTop += displacement()
      }, () => wait(100))
    }
    // A test-driven scroll is done once its frames stop moving: no running chrome animation,
    // no pending title render, and the same geometry for six painted frames.
    const still = async () => {
      const chrome = () => [leaf.view.containerEl.querySelector('.view-header'), root.closest('.abele-timeline-sidebar')?.querySelector('.abele-calendar')]
      let last, steady = 0
      for (let i = 0; i < 300; i++) {
        const now = JSON.stringify([scroller.scrollTop, scroller.scrollHeight, pinned()?.getBoundingClientRect().top, chromeBottom(), usableTop(), dates().length])
        const moving = renders.pending() || chrome().some(el => el && (el.getAnimations?.({ subtree: true }) ?? []).some(a => a.pending || a.playState === 'running'))
        steady = !moving && now === last ? steady + 1 : 0
        if (steady >= 6) return
        last = now
        await new Promise(done => requestAnimationFrame(done))
      }
      throw Error('timeline did not come to rest; state=' + JSON.stringify(uiState()))
    }
    // Scroll to the end until a row appears, re-scrolling once the next page has grown the
    // content (700 ms stays the bound per page).
    const scrollToRow = async (has, pages) => {
      for (let i = 0; i < pages && !has(); i++) {
        const height = scroller.scrollHeight
        scroller.scrollTop = height
        for (let t = 0; t < 14 && !has() && scroller.scrollHeight === height; t++) await wait(50)
      }
    }
    // The row a reader is on: the first drawn below the pinned header, an unfinished one first
    // (it survives both directions of the completed switch), as the timeline itself picks it.
    const readTop = () => usableTop() + (pinned()?.getBoundingClientRect().height ?? 0)
    const taskRows = () => [...root.querySelectorAll('[data-timeline-item^="task:"]')]
    const readRow = rows => {
      const top = readTop(), bottom = scroller.getBoundingClientRect().bottom
      return rows.find(el => { const r = el.getBoundingClientRect(); return r.top >= top && r.top < bottom && !el.querySelector('input:checked') }) ??
        rows.find(el => { const r = el.getBoundingClientRect(); return r.bottom > top && r.top < bottom })
    }
    const groupOf = el => el.closest('.abele-timeline__date-block')
    const rowId = el => [el.dataset.timelineItem, groupOf(el)?.dataset.timelineGroup, groupOf(el)?.dataset.abeleAnchor]
    const rowBy = id => taskRows().find(el => JSON.stringify(rowId(el)) === JSON.stringify(id))
    // A fold row out of reach is first scrolled to just under the pinned header, as a reader
    // would before tapping it; nothing in the list moves it there by itself.
    const reach = async fold => {
      const r = fold().getBoundingClientRect()
      if (r.top >= readTop() && r.bottom <= scroller.getBoundingClientRect().bottom) return
      scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }))
      scroller.scrollTop += r.top - readTop() - 8
      await still()
    }
    // One fold click, read on the row the reader was on: a row still drawn stays where it was;
    // when the fold takes every row in sight away, the nearest remaining row comes to that place.
    const foldAnchor = async (fold, closing = null) => {
      await reach(fold)
      const read = readRow(taskRows())
      if (!read) throw Error('no row in sight to read; state=' + JSON.stringify(uiState()))
      const at = read.getBoundingClientRect().top
      const survivors = taskRows().filter(el => !closing || groupOf(el)?.dataset.timelineGroup !== closing)
      const shown = readRow(survivors)
      const target = shown ?? survivors.reduce((near, el) => !near || Math.abs(el.getBoundingClientRect().top - at) < Math.abs(near.getBoundingClientRect().top - at) ? el : near, null)
      if (!target) throw Error('no row survives the fold; state=' + JSON.stringify(uiState()))
      const expected = shown ? shown.getBoundingClientRect().top : at
      const id = rowId(target)
      await foldClick(fold)
      await settleUI()
      return [expected, rowBy(id)?.getBoundingClientRect().top ?? -9999]
    }
    const shot = async name => {
      const path = shots + '/' + phase + '-' + (${short} ? 'short-' : '') + (${footer} ? 'footer' : 'sidebar') + '-' + (app.isMobile ? 'phone' : 'desktop') + '-' + name + '.png'
      if (window.__e2eHost) await window.__e2eHost.shot(path)
      else {
        const fs = require('fs'); fs.mkdirSync(shots, { recursive: true })
        const remote = require('@electron/remote')
        const wc = remote.getCurrentWebContents()
        // Capture the painted page, then crop it. Electron's capturePage(rect) asks the
        // window compositor for a copy surface: after a phone resize it can fail with
        // UnknownVizError. DevTools captures the viewport without resizing or moving content.
        const capturePage = async rect => {
          const { data } = await wc.debugger.sendCommand('Page.captureScreenshot', {
            format: 'png', fromSurface: true, captureBeyondViewport: false,
          })
          const image = remote.nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
          return rect ? image.crop(viewportRasterCrop(image.getSize(), { width: innerWidth, height: innerHeight }, rect)) : image
        }
        const el = blocks().find(x => x.dataset.abeleAnchor === 'date:' + day(0))
        const capture = async suffix => {
          // Repaint the whole page after each stylesheet change (including the canary), then
          // wait for a stable raster. Cached ancestor paint chunks otherwise leave AA pixels
          // at a different origin even though layout and computed styles are identical.
          const visibility = document.body.style.visibility
          try {
            document.body.style.visibility = 'hidden'
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
          } finally { document.body.style.visibility = visibility }
          await wait(200)
          const captured = await stableCapture(async () => {
            const r = el.getBoundingClientRect()
            const rect = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
            let image
            try { image = await capturePage(rect) } catch (error) {
              throw Error('Timeline Page.captureScreenshot failed: ' + JSON.stringify({ rect,
                viewport: [innerWidth, innerHeight], devicePixelRatio, suffix }) + ': ' + String(error))
            }
            const pixels = image.toBitmap()
            const size = image.getSize()
            if (pixels.length !== size.width * size.height * 4) throw Error('timeline raster dimensions do not match its pixels')
            return { image, pixels, pixelWidth: size.width,
              rect: [r.left, r.top, r.width, r.height], crop: [rect.x, rect.y, rect.width, rect.height], devicePixelRatio }
          }, () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
          fs.writeFileSync(path.replace('.png', suffix + '.png'), captured.image.toPNG())
          return captured
        }
        if (name === 'unchanged') {
          // Compare the ORIGINAL block in its real scroll owner, not a clone or a moved
          // camera. The frozen stylesheet is rendered on this very build/DOM/theme path.
          // Keep all current chrome and shared controls in both captures; only the date
          // block's own rules come from the frozen reference.
          const sheet = [...document.querySelectorAll('style')].find(s => s.textContent.includes('.abele-timeline__date-block'))
          if (!sheet) throw Error('timeline stylesheet not found')
          const current = sheet.textContent
          try {
            sheet.textContent = ${JSON.stringify(comparisonCss)}
            const before = await capture('-before')
            sheet.textContent = current
            const after = await capture('-after')
            report.appearanceRects = [before.rect, after.rect]
            const difference = pixelDifference(before, after)
            report.appearancePixels = difference.count
            report.appearanceCoordinates = difference.coordinates
            report.appearanceRaster = [before, after].map(({ pixelWidth, crop, devicePixelRatio }) => ({ pixelWidth, crop, devicePixelRatio }))
            if (difference.count !== 0) console.warn('timeline pixel difference', JSON.stringify({
              rects: report.appearanceRects, raster: report.appearanceRaster, ...difference,
            }))
            // Positive sensitivity control: a one-pixel change of an existing row must be
            // detected. It changes neither the test expectation nor the reference.
            sheet.textContent += '\n.abele-timeline__tasks { transform: translateX(1px) !important; }'
            const canary = await capture('-canary')
            report.appearanceCanary = pixelDifference(after, canary).count
            // Independent positive geometry control: moving the original block by one pixel
            // must be visible to the exact position contract even if its cropped raster matches.
            sheet.textContent = current + '\n.abele-timeline__date-block { transform: translateX(1px) !important; }'
            const positionCanary = await capture('-position-canary')
            report.appearancePositionCanary = [after.rect, positionCanary.rect]
          } finally { sheet.textContent = current }
          await capture('')
        } else fs.writeFileSync(path, (await capturePage()).toPNG())
      }
      report.shots.push(path)
    }
    yield 'initial dates and unchanged appearance'
    await until(() => dates().length === ${short ? 1 : 20} && overdueRow()?.querySelector('.abele-timeline__overdue-count')?.getAttribute('aria-label') === ${short ? "'2 unfinished'" : "'90 unfinished'"}, 'initial fixture dates and unfinished count')
    await settleUI()
    if (!${footer} && document.body.classList.contains('is-phone')) {
      const calendar = root.closest('.abele-timeline-sidebar').querySelector('.abele-calendar')
      const header = leaf.view.containerEl.querySelector('.view-header')
      if (!calendar || !header) throw Error('calendar or native view header missing')
      report.calendarGap = calendar.getBoundingClientRect().top - header.getBoundingClientRect().bottom
      const panel = root.closest('.abele-timeline-sidebar'), bodyStyle = getComputedStyle(document.body)
      report.calendarLayout = { scrollTop: panel.scrollTop, panelTop: panel.getBoundingClientRect().top, calendarTop: calendar.getBoundingClientRect().top,
        headerTop: header.getBoundingClientRect().top, headerBottom: header.getBoundingClientRect().bottom, paddingTop: getComputedStyle(panel).paddingTop,
        safe: bodyStyle.getPropertyValue('--safe-area-inset-top'), viewHeader: bodyStyle.getPropertyValue('--view-header-height') }
    }
    report.initial = dates()
    report.summary = foldState(overdueRow())
    // Done tasks are hidden, so there is no past day to open yet.
    report.pastHidden = !pastRow()
    // Bring today's unchanged block into sight even in the baseline (which starts in history).
    if (!row(0)) await scrollToRow(() => row(0), 6)
    await until(() => row(0)?.textContent.includes('Sample item 0 1'))
    const todayBlock = blocks().find(x => x.dataset.abeleAnchor === 'date:' + day(0))
    scroller.scrollTop += todayBlock.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 200
    await settleUI()
    await shot('unchanged')
    await shot('initial')
    // Lazy markdown titles must be painted before the row's baseline is measured.
    await until(() => row(0)?.textContent.includes('Sample item 0 1'))
    if (${short}) {
      yield 'short-list completion and fold anchors'
      count('initial')
      const before = row(0).getBoundingClientRect().top
      await toggleCompleted()
      report.anchored = [before, row(0)?.getBoundingClientRect().top ?? -9999]
      count('completed shown')
      await shot('completed')
      const beforeHide = row(0).getBoundingClientRect().top
      await toggleCompleted()
      report.hiddenAnchor = [beforeHide, row(0)?.getBoundingClientRect().top ?? -9999]
      report.revealAnchor = await foldAnchor(overdueRow)
      report.revealed = dates()
      report.overdueRows = groupRows('overdue').length
      report.overdueRowsDone = groupRows('overdue').filter(done).length
      count('overdue open')
      const beforeShown = row(0).getBoundingClientRect().top
      await toggleCompleted()
      report.pastShownAnchor = [beforeShown, row(0).getBoundingClientRect().top]
      count('overdue open, completed shown')
      report.pastAnchor = await foldAnchor(pastRow)
      report.pastDays = groupDays('history')
      report.pastRows = groupRows('history').length
      report.pastRowsOpen = groupRows('history').filter(x => !done(x)).length
      count('both folds open')
      report.overdueCollapseAnchor = await foldAnchor(overdueRow, 'overdue')
      count('past days open')
      report.collapseAnchor = await foldAnchor(pastRow, 'history')
      report.collapsed = dates()
      await toggleCompleted()
      count('folded, completed hidden')
      root.querySelector('.abele-timeline__search-toggle').click()
      await until(() => root.querySelector('.abele-timeline__search input'), 'search input')
      const input = root.querySelector('.abele-timeline__search input')
      input.value = 'sample-no-match'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await settleUI(() => blocks().length === 0 && !!root.querySelector('.abele-timeline__no-tasks'))
      report.emptySpace = root.querySelector('.abele-timeline__anchor-space').getBoundingClientRect().height
      return JSON.stringify(report)
    }

    yield 'pinned header and native scroll'
    // The header with its switches stays at the usable edge, without changing pane spacing.
    const stickyScroll = scroller.scrollTop
    await hoverCheck('at rest')
    scroller.scrollTop += 400
    await still()
    report.chromeGap = pinned().getBoundingClientRect().top - chromeBottom()
    report.sticky = Math.abs(pinned().getBoundingClientRect().top - usableTop())
    await hoverCheck('scrolled')
    scroller.scrollTop = stickyScroll
    await still()

    // Reach the upper boundary and scroll past it: input stays native, the folds stay folded.
    const first = blocks()[0]
    scroller.scrollTop += first.getBoundingClientRect().top - usableTop() - (pinned()?.getBoundingClientRect().height ?? 0)
    await still()
    const nativeBefore = scroller.scrollTop
    let prevented = false, moves = 0, fingerY = null, inputDistance = 0, nativeEnd = null
    const touchStart = e => { fingerY = e.touches[0]?.clientY ?? null }
    const touchMove = e => {
      moves++; prevented ||= e.defaultPrevented
      const y = e.touches[0]?.clientY ?? null
      if (y !== null && fingerY !== null) inputDistance += y - fingerY
      fingerY = y
    }
    // WebKit's compositor applies the last pan after touchend. Measure the first painted
    // release frame, not stale main-thread scrollTop in the event, nor the later inertial end.
    const touchEnd = () => { requestAnimationFrame(() => { nativeEnd = scroller.scrollTop }) }
    const wheel = e => { moves++; prevented ||= e.defaultPrevented; inputDistance -= e.deltaY }
    scroller.addEventListener('touchstart', touchStart, { passive: true })
    scroller.addEventListener('touchmove', touchMove, { passive: true })
    scroller.addEventListener('touchend', touchEnd, { passive: true })
    scroller.addEventListener('wheel', wheel, { passive: true })
    const r = scroller.getBoundingClientRect()
    // Start in scroll content, clear of native navigation and the sticky banner.
    const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + Math.max(200, r.height * 0.45))
    if (window.__e2eHost) {
      // Match the emulated pan's slow travel, rather than the driver's default flick.
      await window.__e2eHost.swipe(x, y, x, y + 80, { velocity: 160 })
    } else {
      const cdp = require('@electron/remote').getCurrentWebContents().debugger
      if (app.isMobile) {
        const touch = (type, at) => cdp.sendCommand('Input.dispatchTouchEvent', {
          type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: at }],
        })
        await touch('touchStart', y)
        for (let i = 1; i <= 8; i++) {
          await touch('touchMove', y + i * 10)
          await wait(60)
        }
        await wait(300)
        await touch('touchEnd')
      } else await cdp.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x, y, deltaX: 0, deltaY: -80,
      })
    }
    // The input has landed once the owner moved or the release frame was recorded (800 ms bound).
    for (let t = 0; t < 16 && nativeEnd === null && Math.abs(scroller.scrollTop - nativeBefore) <= 0.5; t++) await wait(50)
    // The phone's physical swipe can keep coasting after the host call returns. Wait for
    // native motion to end before another case positions rows or taps a moving banner.
    let lastTop = scroller.scrollTop, stableSince = Date.now()
    const settleDeadline = Date.now() + 8000
    while (Date.now() - stableSince < 1000) {
      if (Date.now() > settleDeadline) throw Error('native scrolling did not settle')
      await wait(100)
      if (Math.abs(scroller.scrollTop - lastTop) > 0.5) {
        lastTop = scroller.scrollTop
        stableSince = Date.now()
      }
    }
    report.nativeInput = moves > 0 && !prevented
    report.nativeScroll = [nativeBefore, nativeEnd ?? scroller.scrollTop]
    report.nativeDistance = inputDistance
    report.nativeSettled = nativeBefore - scroller.scrollTop
    scroller.removeEventListener('touchstart', touchStart)
    scroller.removeEventListener('touchmove', touchMove)
    scroller.removeEventListener('touchend', touchEnd)
    scroller.removeEventListener('wheel', wheel)
    report.scrollRevealed = dates()
    yield 'pinned header far down, and the count of every open task'
    // Every page ahead drawn, the header still pinned and its switch still under the pointer.
    await scrollToRow(() => row(45), 6)
    await until(() => row(45), 'last fixture day drawn')
    scroller.scrollTop = scroller.scrollHeight
    await still()
    report.pinnedFar = Math.abs(pinned().getBoundingClientRect().top - usableTop())
    const switchEl = root.querySelector('.abele-timeline__completed-toggle')
    const switchBox = switchEl.getBoundingClientRect()
    report.pinnedHit = switchEl.contains(document.elementFromPoint(switchBox.left + switchBox.width / 2, switchBox.top + switchBox.height / 2))
    report.pinnedGround = getComputedStyle(pinned()).backgroundColor
    await hoverCheck('far down')
    count('folded, completed hidden')
    await shot('far-down')
    yield 'revealing overdue, then past days, and completion anchors'
    report.daysBeforeReveal = groupDays('days')
    report.revealAnchor = await foldAnchor(overdueRow)
    report.revealed = dates()
    report.revealedOverdue = groupDays('overdue')
    report.daysAfterReveal = groupDays('days')
    report.overdueRows = groupRows('overdue').length
    report.overdueRowsDone = groupRows('overdue').filter(done).length
    report.countAfter = foldState(overdueRow())
    count('overdue open')
    await hoverCheck('overdue open')
    await shot('overdue-open')
    // Keep the first incomplete row under the eye while completed rows appear above it.
    await align(row(0)); await wait(500)
    const before = row(0).getBoundingClientRect().top
    await toggleCompleted()
    report.anchored = [before, row(0)?.getBoundingClientRect().top ?? -9999]
    count('overdue open, completed shown')
    report.pastAnchor = await foldAnchor(pastRow)
    report.allHistory = groupDays('history').includes('date:' + day(-90))
    report.pastCompleted = !!groupRows('history').find(x => x.dataset.timelineItem && (x.dataset.abeleAnchor ?? x.querySelector('[data-abele-anchor]')?.dataset.abeleAnchor) === 'task:' + folder + '/Sample item -45 0.md')
    report.pastDays = groupDays('history')
    report.pastRows = groupRows('history').length
    report.pastRowsOpen = groupRows('history').filter(x => !done(x)).length
    report.overflow = scroller.scrollWidth - scroller.clientWidth
    count('both folds open, completed shown')
    await hoverCheck('both open')
    await shot('completed')
    await align(row(0)); await wait(500)
    const beforeHide = row(0)?.getBoundingClientRect().top ?? -9999
    await toggleCompleted()
    report.hiddenAnchor = [beforeHide, row(0)?.getBoundingClientRect().top ?? -9999]
    yield 'future rows and folding both away'
    await scrollToRow(() => row(25), 4)
    await until(() => row(25))
    await align(row(25)); await settleUI()
    const futureBefore = row(25).getBoundingClientRect().top
    await toggleCompleted()
    report.futureAnchor = [futureBefore, row(25)?.getBoundingClientRect().top ?? -9999]
    // Folding away the rows being read brings the nearest remaining row to where they were.
    report.pastCollapseAnchor = await foldAnchor(pastRow, 'history')
    report.removedPastAnchor = await foldAnchor(overdueRow, 'overdue')
    report.collapsed = dates()
    report.collapseSummary = foldState(overdueRow())
    await shot('hidden-past')
    report.rerevealAnchor = await foldAnchor(overdueRow)
    if (${footer}) {
      yield 'reopening a saved overdue place and row anchor'
      // A saved overdue row is useful only if reopening opens its fold and draws that day again.
      await toggleCompleted()
      config.rememberNotePlaces = true
      await align(row(-1)); await wait(1500)
      const beforeReturn = row(-1).getBoundingClientRect().top - scroller.getBoundingClientRect().top
      await leaf.openFile(app.vault.getAbstractFileByPath(folder + '/Sample item 0 1.md'))
      await wait(500)
      await leaf.openFile(app.vault.getAbstractFileByPath(folder + '/Sample group.md'))
      await wait(2000)
      // The place is put back once the reopened timeline has drawn the day; on a loaded machine
      // that is later than any fixed wait, so the row is read once the view stopped moving.
      const savedRow = () => [...(leaf.view.containerEl.querySelector('.abele-timeline')?.querySelectorAll('.abele-task-view') ?? [])]
        .find(x => x.dataset.abeleAnchor === 'task:' + folder + '/Sample item -1 1.md')
      if (await until(() => savedRow(), 'reopened overdue row').catch(() => false))
        await settleUI(() => true, leaf.view.containerEl.querySelector('.abele-timeline'), leaf.view.containerEl.querySelector('.cm-scroller'))
      const reopened = leaf.view.containerEl.querySelector('.abele-timeline')
      const returned = savedRow()
      report.restoredHistory = !!returned
      report.restoredAnchor = [beforeReturn, returned ? returned.getBoundingClientRect().top - leaf.view.containerEl.querySelector('.cm-scroller').getBoundingClientRect().top : -9999]
      reopened.querySelector('.abele-timeline__overdue').click()
      await until(() => reopened.querySelector('.abele-timeline__overdue')?.getAttribute('aria-expanded') === 'false', 'reopened overdue folded')
      await settleUI(() => true, reopened, leaf.view.containerEl.querySelector('.cm-scroller'))
      await leaf.openFile(app.vault.getAbstractFileByPath(folder + '/Sample item 0 1.md'))
      await wait(500)
      await leaf.openFile(app.vault.getAbstractFileByPath(folder + '/Sample group.md'))
      await wait(2000)
      const foldedAgain = leaf.view.containerEl.querySelector('.abele-timeline')
      report.restoredCollapsed = foldedAgain?.querySelector('.abele-timeline__overdue')?.getAttribute('aria-expanded') === 'false' &&
        ![...foldedAgain.querySelectorAll('.abele-timeline__date-block')].some(x => x.dataset.abeleAnchor < 'date:' + day(0))
    }
  } catch (e) { report.error = String(e) + '\n' + (e?.stack ?? '') }
  finally { renders.restore(); leaf?.detach(); config.rememberNotePlaces = remembered }
  return JSON.stringify(report)
})()`

async function runProbe(footer: boolean, short = false): Promise<Probe> {
  const label = `${footer ? 'footer' : 'sidebar'} ${short ? 'short' : 'full'}`
  let phase = 'starting'
  evalRaw(`(() => { window.__timelineProbe = (${script(footer, short)}); return 'started' })()`)
  try {
    for (;;) {
      console.info(`Timeline ${label}: ${phase}`)
      const raw = await evalLong('window.__timelineProbe.next()', 100_000)
      if (raw.startsWith('Error:')) throw new Error(raw)
      const step = JSON.parse(raw) as { done: boolean; value: string }
      if (step.done) return JSON.parse(step.value) as Probe
      phase = step.value
    }
  } catch (error) {
    throw new Error(`Timeline ${label}, phase ${phase}: ${String(error)}`)
  } finally {
    // A timed-out step still has a live generator; close it so its fixture finally runs.
    await evalLong(
      `(async () => { await window.__timelineProbe?.return(); delete window.__timelineProbe; return 'closed' })()`,
      60_000
    )
  }
}

const REMOVE_TIMELINE_FIXTURE = `
  async function removeTimelineFixture(path, label) {
    const folder = app.vault.getAbstractFileByPath(path)
    const files = [...(folder?.children ?? [])]
    // Prove every file before deleting any: a synthetic folder name is not ownership.
    for (const file of files) {
      if (file.children) throw Error('unowned nested fixture folder: ' + file.path)
      const text = await app.vault.read(file)
      const fm = app.metadataCache.getFileCache(file)?.frontmatter
      const group = file.path === path + '/Sample group.md' && text === 'Sample group\\n'
      const task = /^Sample (?:item -?\\d+ [0-2]|archive -\\d+)\\.md$/.test(file.name) &&
        fm?.type === 'task' && Array.isArray(fm.labels) && fm.labels.includes(label) &&
        Array.isArray(fm.groups) && fm.groups.includes('[[' + path + '/Sample group]]')
      if (!group && !task) throw Error('unowned fixture file: ' + file.path)
    }
    // Individual native deletes publish file events before the empty folder is removed.
    for (const file of files) await app.vault.delete(file, true)
    if (folder) await app.vault.delete(folder, true)
    const deadline = Date.now() + 60000
    while ([...window.__abeleTest.GlobalStore.getInstance().tasksList.value.tasks.keys()].some(key => key.startsWith(path + '/'))) {
      if (Date.now() > deadline) throw Error('deleted fixture tasks remained in the store: ' + path)
      await new Promise(done => setTimeout(done, 100))
    }
    return 'removed folder'
  }
`

// Synthetic fixtures may survive an interrupted run. Remove only proven owned notes.
async function removeFixtures(): Promise<void> {
  for (const dir of [FOLDER, FOLDER + ' short']) {
    const raw = await evalLong(
      `(async () => {
        ${REMOVE_TIMELINE_FIXTURE}
        return await removeTimelineFixture(${JSON.stringify(dir)}, ${JSON.stringify('sample-timeline-probe' + (dir.endsWith(' short') ? '-short' : ''))})
      })()`,
      120_000
    )
    if (raw.startsWith('Error:')) throw new Error(raw)
  }
}

describe.skipIf(!available)('task timeline scrolling', () => {
  let desktop: Probe[] = [],
    mobile: Probe[] = []
  const shortDesktop: Probe[] = [],
    shortMobile: Probe[] = []
  let state: { size: number[]; layout: unknown } | null = null
  beforeAll(async () => {
    if (!onPhone()) {
      const reference = readFileSync(await timelineStyleReference(), 'utf8')
      const current = evalRaw(
        `[...document.querySelectorAll('style')].find(s => s.textContent.includes('.abele-timeline__date-block')).textContent`
      )
      const appearance = timelineStructuralCss(reference, true)
      if (!appearance.includes('.abele-timeline__date-block'))
        throw Error('Frozen date-block rules missing')
      comparisonCss = timelineStructuralCss(current) + '\n' + appearance
    }
    state = JSON.parse(
      evalRaw(
        `JSON.stringify({ size: window.__e2eHost ? [] : require('@electron/remote').getCurrentWindow().getContentSize(), layout: app.workspace.getLayout() })`
      )
    )
    await removeFixtures()
    if (!onPhone()) {
      runCli(['dev:debug', 'on'], 30000)
      for (const footer of [false, true]) {
        desktop.push(await runProbe(footer))
        shortDesktop.push(await runProbe(footer, true))
      }
      await enterPhone(390, 844)
      runCli(['dev:debug', 'on'], 30000)
    }
    for (const footer of [false, true]) {
      mobile.push(await runProbe(footer))
      shortMobile.push(await runProbe(footer, true))
    }
    console.info(JSON.stringify({ desktop, mobile, shortDesktop, shortMobile }))
  }, 600_000)
  afterAll(async () => {
    if (!available) return
    try {
      await removeFixtures()
    } finally {
      if (state) {
        if (!onPhone()) {
          evalRaw(
            `require('@electron/remote').getCurrentWindow().setContentSize(${state.size.join(',')}); 'restored'`
          )
          await reloadApp('app.emulateMobile(false)')
        }
        await evalLong(
          `(async () => { await app.workspace.changeLayout(${JSON.stringify(state.layout)}); return 'restored' })()`,
          60000
        )
      }
    }
  }, 300_000)
  for (const kind of ['desktop', 'phone width']) {
    for (const [index, owner] of ['sidebar', 'note footer'].entries()) {
      const probe = () => (kind === 'desktop' ? desktop : mobile)[index]
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: holds a task even when a short list cannot otherwise scroll far enough`,
        () => {
          const p = (kind === 'desktop' ? shortDesktop : shortMobile)[index]
          expect(p.error).toBeUndefined()
          expect(p.emptySpace).toBe(0)
          // Overdue opens yesterday's undone rows above today, and nothing done.
          expect(p.revealed).toHaveLength(2)
          expect(p.overdueRows).toBe(2)
          expect(p.overdueRowsDone).toBe(0)
          // Past days open on their own: the 45 completed-only archive days and yesterday's done row.
          expect(p.pastDays).toHaveLength(46)
          expect(p.pastRows).toBe(46)
          expect(p.pastRowsOpen).toBe(0)
          expect(p.collapsed).toHaveLength(1)
          for (const pair of [
            p.anchored,
            p.hiddenAnchor,
            p.revealAnchor,
            p.pastShownAnchor,
            p.pastAnchor,
            p.overdueCollapseAnchor,
            p.collapseAnchor,
          ]) {
            expect(pair).toHaveLength(2)
            expect(Math.abs(pair![1] - pair![0])).toBeLessThanOrEqual(1)
          }
        }
      )
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: the heading counts exactly the tasks open in the list, in every fold state`,
        () => {
          for (const p of [probe(), (kind === 'desktop' ? shortDesktop : shortMobile)[index]]) {
            expect(p.error).toBeUndefined()
            for (const [state, heading, open] of p.counts!)
              expect(heading, `${state}: heading against open tasks`).toBe(open)
          }
          // Today on: 46 days of two undone; overdue 45 days of two; done rows 46 + 90 more.
          expect(probe().counts!.map(([state, heading]) => [state, heading])).toEqual([
            ['folded, completed hidden', 92],
            ['overdue open', 182],
            ['overdue open, completed shown', 228],
            ['both folds open, completed shown', 318],
          ])
          const short = (kind === 'desktop' ? shortDesktop : shortMobile)[index]
          expect(short.counts!.map(([state, heading]) => [state, heading])).toEqual([
            ['initial', 2],
            ['completed shown', 3],
            ['overdue open', 4],
            ['overdue open, completed shown', 5],
            ['both folds open', 51],
            ['past days open', 49],
            ['folded, completed hidden', 2],
          ])
        }
      )
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: scroll stays native, and Overdue opens only what was left undone without moving the row`,
        () => {
          const p = probe()
          expect(p.error).toBeUndefined()
          expect(p.initial).toHaveLength(20)
          expect(p.summary).toBe('90 unfinished · Show overdue tasks')
          expect(p.pastHidden).toBe(true)
          expect(p.scrollRevealed).toEqual(p.initial)
          expect(p.nativeInput).toBe(true)
          expect(p.nativeScroll).toHaveLength(2)
          expect(p.nativeDistance).toBeGreaterThan(0)
          const displacement = p.nativeScroll![0] - p.nativeScroll![1]
          expect(displacement).toBeGreaterThan(p.nativeDistance! / 2)
          // Touch slop is platform-owned, not a reason to accept zero or reversed scroll.
          expect(Math.abs(displacement - p.nativeDistance!)).toBeLessThanOrEqual(24)
          expect(p.nativeSettled).toBeGreaterThanOrEqual(displacement - 2)
          // 45 days with two undone each, and no completed-only archive day among them.
          expect(p.revealedOverdue).toHaveLength(45)
          expect(p.revealedOverdue!.every((date) => date < p.initial![0])).toBe(true)
          expect(p.overdueRows).toBe(90)
          expect(p.overdueRowsDone).toBe(0)
          expect(p.daysAfterReveal).toEqual(p.daysBeforeReveal)
          expect(p.countAfter).toBe('90 unfinished · Hide overdue tasks')
          expect(p.chromeGap).toBeGreaterThanOrEqual(-1)
          if (index === 0 && kind === 'phone width')
            expect(p.calendarGap, JSON.stringify(p.calendarLayout)).toBeGreaterThanOrEqual(0)
          expect(p.sticky).toBeLessThanOrEqual(2)
          expect(p.overflow).toBeLessThanOrEqual(1)
          expect(p.revealAnchor).toHaveLength(2)
          expect(Math.abs(p.revealAnchor![1] - p.revealAnchor![0])).toBeLessThanOrEqual(1)
        }
      )
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: the header stays pinned and reachable far down, and no row covers another, hovered or not`,
        () => {
          const p = probe()
          expect(p.error).toBeUndefined()
          expect(p.pinnedFar).toBeLessThanOrEqual(2)
          expect(p.pinnedHit).toBe(true)
          // Opaque, so the days passing under it never show through.
          expect(p.pinnedGround).toMatch(/^rgb\(/)
          expect(p.overlaps ?? []).toEqual([])
          if (!onPhone()) expect(p.hoverChecked).toBeGreaterThan(0)
        }
      )
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: Past days open apart from Overdue, with every done row and none left undone`,
        () => {
          const p = probe()
          expect(p.error).toBeUndefined()
          // 45 completed-only archive days and 45 days with one done row each.
          expect(p.pastDays).toHaveLength(90)
          expect(p.pastRows).toBe(90)
          expect(p.pastRowsOpen).toBe(0)
          expect(p.allHistory).toBe(true)
          expect(p.pastCompleted).toBe(true)
          expect(p.pastAnchor).toHaveLength(2)
          expect(Math.abs(p.pastAnchor![1] - p.pastAnchor![0])).toBeLessThanOrEqual(1)
        }
      )
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: folds away the rows in sight by bringing the nearest remaining row to their place, and reopens without moving a row`,
        () => {
          const p = probe()
          expect(p.error).toBeUndefined()
          expect(p.collapsed!.every((date) => date >= p.initial![0])).toBe(true)
          expect(p.collapseSummary).toBe('90 unfinished · Show overdue tasks')
          for (const pair of [p.pastCollapseAnchor, p.removedPastAnchor, p.rerevealAnchor]) {
            expect(pair).toHaveLength(2)
            expect(Math.abs(pair![1] - pair![0])).toBeLessThanOrEqual(1)
          }
        }
      )
      if (index === 1)
        it.skipIf(kind === 'desktop' && onPhone())(
          `${kind}, ${owner}: reopening restores an open overdue fold and its row anchor`,
          () => {
            const p = probe()
            expect(p.error).toBeUndefined()
            expect(p.restoredHistory).toBe(true)
            expect(p.restoredCollapsed).toBe(true)
            expect(p.restoredAnchor).toHaveLength(2)
            expect(Math.abs(p.restoredAnchor![1] - p.restoredAnchor![0])).toBeLessThanOrEqual(2)
          }
        )
      it.skipIf(onPhone())(
        `${kind}, ${owner}: existing date blocks are pixel-identical in place`,
        () => {
          for (const p of [probe(), (kind === 'desktop' ? shortDesktop : shortMobile)[index]]) {
            expect(p.error).toBeUndefined()
            expect(p.appearanceRects).toHaveLength(2)
            expect(p.appearanceRects![1]).toEqual(p.appearanceRects![0])
            expect(p.appearancePixels).toBe(0)
            expect(p.appearanceCanary).toBeGreaterThan(0)
            expect(p.appearancePositionCanary).toHaveLength(2)
            expect(p.appearancePositionCanary![1][0] - p.appearancePositionCanary![0][0]).toBe(1)
            expect(p.appearancePositionCanary![1].slice(1)).toEqual(
              p.appearancePositionCanary![0].slice(1)
            )
          }
        }
      )
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: completed toggles hold the same row within one pixel`,
        () => {
          const p = probe()
          expect(p.error).toBeUndefined()
          for (const pair of [p.anchored, p.hiddenAnchor, p.futureAnchor]) {
            expect(pair).toHaveLength(2)
            expect(Math.abs(pair![1] - pair![0])).toBeLessThanOrEqual(1)
          }
        }
      )
    }
  }
})
