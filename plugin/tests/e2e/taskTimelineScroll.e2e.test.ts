/** Folded history and viewport anchoring in the task timeline's real scroll owners. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
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
let referenceCss = ''
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
    const strip = () => root.querySelector('.abele-timeline__history')
    uiState = () => ({today:day(0),dates:dates(),history:strip()?.textContent.trim(),
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
      const before = control.textContent
      control.click()
      await settleUI(() => control.textContent !== before)
    }
    const revealClick = async () => {
      const el = strip()
      const expanded = el.getAttribute('aria-expanded')
      if (window.__e2eHost) {
        const r = el.getBoundingClientRect()
        let point
        for (const fy of [0.5, 0.75, 0.25]) for (const fx of [0.5, 0.75, 0.25]) {
          const x = Math.round(r.left + r.width * fx), y = Math.round(r.top + r.height * fy)
          const hit = document.elementFromPoint(x, y)
          if (y >= chromeBottom() && hit && el.contains(hit)) point ??= {x, y}
        }
        if (!point) throw Error('history banner has no hittable point: ' + JSON.stringify({box:r.toJSON(),chrome:chromeBottom()}))
        const {x, y} = point
        const received = []
        const record = e => received.push({ type: e.type, target: e.target.className, prevented: e.defaultPrevented })
        for (const type of ['touchstart', 'touchend', 'click']) document.addEventListener(type, record, true)
        try {
          await window.__e2eHost.tap(x, y)
          await wait(200)
          if (!el.isConnected || el.getAttribute('aria-expanded') === expanded) throw Error('Banner tap did not toggle history: ' + JSON.stringify({ x, y, hit: document.elementFromPoint(x, y)?.className, received }))
        } finally {
          for (const type of ['touchstart', 'touchend', 'click']) document.removeEventListener(type, record, true)
        }
      } else el.click()
      await until(() => strip()?.getAttribute('aria-expanded') !== expanded, 'history toggled')
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
        return el.getBoundingClientRect().top - usableTop() - (strip()?.getBoundingClientRect().height ?? 0) - 8
      }
      await settleTimelinePosition(displacement, () => {
        scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 1 }))
        scroller.scrollTop += displacement()
      }, () => wait(100))
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
          // Keep the intentionally changed sticky banner and phone main-tab inset in both
          // captures; neither is part of the old date block's appearance.
          const sheet = [...document.querySelectorAll('style')].find(s => s.textContent.includes('.abele-timeline__date-block'))
          if (!sheet) throw Error('timeline stylesheet not found')
          const current = sheet.textContent
          const structuralCss = ${timelineStructuralCss.toString()}
          const retained = structuralCss(sheet.sheet.cssRules)
          try {
            sheet.textContent = fs.readFileSync(${JSON.stringify(referenceCss)}, 'utf8') + '\n' + retained
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
    await until(() => dates().length === ${short ? 1 : 20} && strip()?.textContent.includes(${short ? "'2 unfinished'" : "'90 unfinished'"}), 'initial fixture dates and unfinished count')
    await settleUI()
    if (!${footer} && document.body.classList.contains('is-phone')) {
      const calendar = root.closest('.abele-timeline-sidebar').querySelector('.abele-calendar')
      const header = leaf.view.containerEl.querySelector('.view-header')
      if (!calendar || !header) throw Error('calendar or native view header missing')
      report.calendarGap = calendar.getBoundingClientRect().top - header.getBoundingClientRect().bottom
    }
    report.initial = dates()
    report.summary = strip()?.textContent.trim() ?? null
    // Bring today's unchanged block into sight even in the baseline (which starts in history).
    if (!row(0)) {
      for (let i = 0; i < 6 && !row(0); i++) { scroller.scrollTop = scroller.scrollHeight; await wait(700) }
    }
    await until(() => row(0)?.textContent.includes('Sample item 0 1'))
    const todayBlock = blocks().find(x => x.dataset.abeleAnchor === 'date:' + day(0))
    scroller.scrollTop += todayBlock.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 200
    await wait(800)
    await shot('unchanged')
    await shot('initial')
    // Lazy markdown titles must be painted before the row's baseline is measured.
    await until(() => row(0)?.textContent.includes('Sample item 0 1'))
    if (${short}) {
      yield 'short-list completion and history anchors'
      const before = row(0).getBoundingClientRect().top
      await toggleCompleted()
      report.anchored = [before, row(0)?.getBoundingClientRect().top ?? -9999]
      await shot('completed')
      const beforeHide = row(0).getBoundingClientRect().top
      await toggleCompleted()
      report.hiddenAnchor = [beforeHide, row(0)?.getBoundingClientRect().top ?? -9999]
      const beforeReveal = row(0).getBoundingClientRect().top
      await revealClick()
      await settleUI()
      report.revealAnchor = [beforeReveal, row(0).getBoundingClientRect().top]
      report.revealed = dates()
      const beforeCollapse = row(0).getBoundingClientRect().top
      await revealClick()
      await settleUI()
      report.collapseAnchor = [beforeCollapse, row(0).getBoundingClientRect().top]
      report.collapsed = dates()
      root.querySelector('.abele-timeline__search-toggle').click()
      await wait(100)
      const input = root.querySelector('.abele-timeline__search input')
      input.value = 'sample-no-match'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await settleUI(() => blocks().length === 0 && !!root.querySelector('.abele-timeline__no-tasks'))
      report.emptySpace = root.querySelector('.abele-timeline__anchor-space').getBoundingClientRect().height
      return JSON.stringify(report)
    }

    yield 'sticky banner and native scroll'
    // The folded banner stays at the usable edge, without changing existing pane spacing.
    const stickyScroll = scroller.scrollTop
    scroller.scrollTop += 400
    await wait(400)
    report.chromeGap = strip().getBoundingClientRect().top - chromeBottom()
    report.sticky = Math.abs(strip().getBoundingClientRect().top - usableTop())
    scroller.scrollTop = stickyScroll
    await wait(400)

    // Reach the upper boundary and scroll past it: input stays native, history stays folded.
    const first = blocks()[0]
    scroller.scrollTop += first.getBoundingClientRect().top - usableTop() - (strip()?.getBoundingClientRect().height ?? 0)
    await wait(400)
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
    await wait(800)
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
    yield 'revealing history and completion anchors'
    await align(row(0)); await wait(500)
    const beforeReveal = row(0).getBoundingClientRect().top
    await revealClick()
    await settleUI()
    report.revealAnchor = [beforeReveal, row(0).getBoundingClientRect().top]
    report.revealed = dates()
    report.countAfter = strip()?.textContent.trim() ?? null
    // Keep the first incomplete row under the eye while completed rows appear above it.
    await align(row(0)); await wait(500)
    const before = row(0).getBoundingClientRect().top
    await toggleCompleted()
    report.anchored = [before, row(0)?.getBoundingClientRect().top ?? -9999]
    report.allHistory = dates().includes('date:' + day(-90))
    report.pastCompleted = !!row(-45, 0)
    report.overflow = scroller.scrollWidth - scroller.clientWidth
    await shot('completed')
    const beforeHide = row(0)?.getBoundingClientRect().top ?? -9999
    await toggleCompleted()
    report.hiddenAnchor = [beforeHide, row(0)?.getBoundingClientRect().top ?? -9999]
    yield 'future rows and collapsing history'
    for (let i = 0; i < 4 && !row(25); i++) { scroller.scrollTop = scroller.scrollHeight; await wait(700) }
    await until(() => row(25))
    await align(row(25)); await wait(1000)
    const futureBefore = row(25).getBoundingClientRect().top
    await toggleCompleted()
    report.futureAnchor = [futureBefore, row(25)?.getBoundingClientRect().top ?? -9999]
    const beforeCollapse = row(25).getBoundingClientRect().top
    await revealClick()
    await settleUI()
    report.collapseAnchor = [beforeCollapse, row(25).getBoundingClientRect().top]
    report.collapsed = dates()
    report.collapseSummary = strip()?.textContent.trim() ?? null
    const beforeRereveal = row(25).getBoundingClientRect().top
    await revealClick()
    await settleUI()
    report.rerevealAnchor = [beforeRereveal, row(25).getBoundingClientRect().top]
    await align(row(-40)); await wait(1000)
    const removedBefore = row(-40).getBoundingClientRect().top
    await revealClick()
    await settleUI()
    report.removedPastAnchor = [removedBefore, row(0, 0).getBoundingClientRect().top]
    await shot('hidden-past')
    await revealClick()
    await settleUI()
    if (${footer}) {
      yield 'reopening saved history and row anchor'
      // A past row's saved anchor is useful only if reopening actually recreates that day.
      await toggleCompleted()
      config.rememberNotePlaces = true
      await align(row(-1)); await wait(1500)
      const beforeReturn = row(-1).getBoundingClientRect().top - scroller.getBoundingClientRect().top
      await leaf.openFile(app.vault.getAbstractFileByPath(folder + '/Sample item 0 1.md'))
      await wait(500)
      await leaf.openFile(app.vault.getAbstractFileByPath(folder + '/Sample group.md'))
      await wait(2000)
      const reopened = leaf.view.containerEl.querySelector('.abele-timeline')
      const returned = [...(reopened?.querySelectorAll('.abele-task-view') ?? [])].find(x => x.dataset.abeleAnchor === 'task:' + folder + '/Sample item -1 1.md')
      report.restoredHistory = !!returned
      report.restoredAnchor = [beforeReturn, returned ? returned.getBoundingClientRect().top - leaf.view.containerEl.querySelector('.cm-scroller').getBoundingClientRect().top : -9999]
      reopened.querySelector('.abele-timeline__history').click()
      await until(() => reopened.querySelector('.abele-timeline__history')?.getAttribute('aria-expanded') === 'false', 'reopened history folded')
      await settleUI(() => true, reopened, leaf.view.containerEl.querySelector('.cm-scroller'))
      await leaf.openFile(app.vault.getAbstractFileByPath(folder + '/Sample item 0 1.md'))
      await wait(500)
      await leaf.openFile(app.vault.getAbstractFileByPath(folder + '/Sample group.md'))
      await wait(2000)
      const foldedAgain = leaf.view.containerEl.querySelector('.abele-timeline')
      report.restoredCollapsed = foldedAgain?.querySelector('.abele-timeline__history')?.getAttribute('aria-expanded') === 'false' &&
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

// These synthetic folders may survive an interrupted phone run. Always start fresh;
// reusing a partial folder bypasses fixture creation and cannot test timeline behaviour.
async function removeFixtures(): Promise<void> {
  for (const dir of [FOLDER, FOLDER + ' short']) {
    // Folder deletion still goes through the native vault and emits its file events, without
    // hundreds of host round trips. Wait for the store too before recreating the same paths.
    const raw = await evalLong(
      `(async () => {
        const path = ${JSON.stringify(dir)}
        const folder = app.vault.getAbstractFileByPath(path)
        if (folder) await app.vault.delete(folder, true)
        const deadline = Date.now() + 60000
        while ([...window.__abeleTest.GlobalStore.getInstance().tasksList.value.tasks.keys()].some(key => key.startsWith(path + '/'))) {
          if (Date.now() > deadline) throw Error('deleted fixture tasks remained in the store')
          await new Promise(done => setTimeout(done, 100))
        }
        return 'removed folder'
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
    if (!onPhone()) referenceCss = await timelineStyleReference()
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
      await reloadApp('app.emulateMobile(true)')
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390,844); 'sized'`)
      await reloadApp('window.location.reload()')
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
          expect(p.revealed).toHaveLength(2)
          expect(p.collapsed).toHaveLength(1)
          for (const pair of [p.anchored, p.hiddenAnchor, p.revealAnchor, p.collapseAnchor]) {
            expect(pair).toHaveLength(2)
            expect(Math.abs(pair![1] - pair![0])).toBeLessThanOrEqual(1)
          }
        }
      )
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: scroll stays native, one click reveals all past days without moving the row`,
        () => {
          const p = probe()
          expect(p.error).toBeUndefined()
          expect(p.initial).toHaveLength(20)
          expect(p.summary).toContain('90 unfinished')
          expect(p.scrollRevealed).toEqual(p.initial)
          expect(p.nativeInput).toBe(true)
          expect(p.nativeScroll).toHaveLength(2)
          expect(p.nativeDistance).toBeGreaterThan(0)
          const displacement = p.nativeScroll![0] - p.nativeScroll![1]
          expect(displacement).toBeGreaterThan(p.nativeDistance! / 2)
          // Touch slop is platform-owned, not a reason to accept zero or reversed scroll.
          expect(Math.abs(displacement - p.nativeDistance!)).toBeLessThanOrEqual(24)
          expect(p.nativeSettled).toBeGreaterThanOrEqual(displacement - 2)
          expect(p.revealed).toHaveLength(65)
          expect(p.countAfter).toContain('90 unfinished · Hide all')
          expect(p.chromeGap).toBeGreaterThanOrEqual(-1)
          if (index === 0 && kind === 'phone width') expect(p.calendarGap).toBeGreaterThanOrEqual(0)
          expect(p.sticky).toBeLessThanOrEqual(2)
          expect(p.overflow).toBeLessThanOrEqual(1)
          expect(p.revealAnchor).toHaveLength(2)
          expect(Math.abs(p.revealAnchor![1] - p.revealAnchor![0])).toBeLessThanOrEqual(1)
        }
      )
      it.skipIf(kind === 'desktop' && onPhone())(
        `${kind}, ${owner}: hides and reopens history without moving a surviving row, or replaces a removed past row with its nearest remaining row`,
        () => {
          const p = probe()
          expect(p.error).toBeUndefined()
          expect(p.collapsed!.every((date) => date >= p.initial![0])).toBe(true)
          expect(p.collapseSummary).toContain('90 unfinished · Show all')
          for (const pair of [p.collapseAnchor, p.rerevealAnchor, p.removedPastAnchor]) {
            expect(pair).toHaveLength(2)
            expect(Math.abs(pair![1] - pair![0])).toBeLessThanOrEqual(1)
          }
        }
      )
      if (index === 1)
        it.skipIf(kind === 'desktop' && onPhone())(
          `${kind}, ${owner}: reopening restores a revealed past-row anchor`,
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
        `${kind}, ${owner}: completed toggles hold the same row within one pixel and include all revealed history`,
        () => {
          const p = probe()
          expect(p.error).toBeUndefined()
          expect(p.allHistory).toBe(true)
          expect(p.pastCompleted).toBe(true)
          for (const pair of [p.anchored, p.hiddenAnchor, p.futureAnchor]) {
            expect(pair).toHaveLength(2)
            expect(Math.abs(pair![1] - pair![0])).toBeLessThanOrEqual(1)
          }
        }
      )
    }
  }
})
