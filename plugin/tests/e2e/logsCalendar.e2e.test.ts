/** The real note footer, with synthetic dated log notes, at desktop and phone widths. */
import { afterAll, describe, expect, it } from 'vitest'
import { evalLong, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'
import { shotDir } from './helpers/shots'

targets('desktop')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('logs-calendar')
let emulated = false
let originalSize: { width: number; height: number } | undefined

const probe = (label: string) => String.raw`(async () => {
  const api = window.__abeleTest
  const config = api.AbeleConfig.getInstance()
  const store = api.GlobalStore.getInstance()
  const folder = 'Sample calendar probe'
  if (app.vault.getAbstractFileByPath(folder)) throw Error('probe folder already exists')
  const previousRemember = config.rememberNotePlaces
  const previousLeaf = app.workspace.activeLeaf
  const previousViewState = previousLeaf?.getViewState()
  const previousMemory = app.loadLocalStorage('abele-footer-view')
  let leaf
  const report = { renderedHtml: [], galleryEntries: [] }
  const saveEvidence = () => {
    const fs = require('fs')
    fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    fs.writeFileSync(${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-entry-dom.json', JSON.stringify(report, null, 2))
  }
  // Observe the real renderer DOM before the gallery processor changes it. Only this
  // probe's synthetic notes are captured; write immediately so failures keep the evidence.
  const captureRendered = (el, ctx) => {
    if (!ctx.sourcePath.startsWith(folder + '/') || !el.textContent.includes('::abele-gallery')) return
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    const markerParents = []
    while (walker.nextNode()) {
      if (walker.currentNode.textContent.includes('::abele-gallery')) markerParents.push(walker.currentNode.parentElement.tagName)
    }
    report.renderedHtml.push({ sourcePath: ctx.sourcePath, markerParents, outerHTML: el.outerHTML })
    saveEvidence()
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const until = async (fn, name) => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const value = fn()
      if (value) return value
      await wait(100)
    }
    throw Error('not ready: ' + name)
  }
  const create = async (name, body) => {
    const file = await app.vault.create(folder + '/' + name + '.md', body)
    await until(() => app.metadataCache.getFileCache(file), name + ' metadata')
    return file
  }
  const shoot = async name => {
    // Park the pointer outside the note so a native link preview cannot cover the state.
    require('@electron/remote').getCurrentWebContents().sendInputEvent({ type: 'mouseMove', x: 8, y: 400 })
    // Let the native floating phone chrome settle after scrolling before taking the viewport.
    await wait(800)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('window is not drawing')), 5000)
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve() }))
    })
    const fs = require('fs')
    fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    const path = ${JSON.stringify(SHOTS)} + '/' + ${JSON.stringify(label)} + '-' + name + '.png'
    const image = await require('@electron/remote').getCurrentWebContents().capturePage()
    fs.writeFileSync(path, image.toPNG())
  }
  try {
    api.rendering.MarkdownPreviewRenderer.registerPostProcessor(captureRendered, -1)
    config.rememberNotePlaces = false
    store.applySettings()
    await app.vault.createFolder(folder)
    await app.vault.createFolder(folder + '/Media')
    const canvas = document.createElement('canvas')
    canvas.width = 120; canvas.height = 80
    const paint = canvas.getContext('2d')
    paint.fillStyle = '#668899'; paint.fillRect(0, 0, 120, 80)
    const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0))
    await app.vault.createBinary(folder + '/Media/sample-picture.png', bytes.buffer)
    const note = await create('Sample practice', 'A sample practice with dated entries.\n')
    const today = new Date()
    const date = day => today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(day).padStart(2,'0')
    const todayKey = date(today.getDate())
    const longDay = today.getDate() === 14 ? 13 : 14
    const files = []
    const galleryText = '\n::abele-gallery{height=160}::\n\n![[sample-picture.png]]\n\n![[Media/sample-picture.png]]\n\n![Sample](Media/sample-picture.png)'
    for (let day = 1; day <= Math.max(28, today.getDate()); day++) {
      if (day % 5 === 0 && day !== today.getDate() && day !== longDay) continue
      let content = day === longDay
        ? Array.from({length: 14}, (_, i) => 'Sample line ' + (i+1) + ' about [[' + note.path + ']].').join('\n')
        : (day % 3 === 0 ? '- [ ] ' : day % 3 === 1 ? '- [x] ' : '') + 'Sample entry for [[' + note.path + ']].'
      // The gallery probe asserts tight-list markup, regardless of today's day number.
      if (day === today.getDate()) content = '- [ ] Sample entry for [[' + note.path + ']].' + galleryText
      const file = await create(date(day), '---\ntype: log\ncreated: ' + date(day) + '\n---\n' + content + '\n')
      files.push(file)
    }
    const ordinary = await create('Sample ordinary entry', '---\ntype: log\ncreated: ' + todayKey + '\n---\nSample ordinary entry for [[' + note.path + ']].\n' + galleryText)
    await until(() => app.metadataCache.resolvedLinks[ordinary.path]?.[note.path], 'ordinary entry links')
    await until(() => files.every(file => app.metadataCache.resolvedLinks[file.path]?.[note.path]), 'resolved log links')
    leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(note, { state: { mode: 'source', source: false } })
    app.workspace.setActiveLeaf(leaf, { focus: true })
    const root = () => leaf.view.containerEl
    const toggle = await until(() => root().querySelector('.abele-logs-list__view'), 'logs view toggle')
    toggle.click()
    const calendar = await until(() => root().querySelector('.abele-logs-calendar'), 'calendar')
    const section = root().querySelector('.abele-logs-list')
    section.scrollIntoView({ block: 'start' })
    await until(() => calendar.querySelectorAll('.abele-calendar__day-log').length >= files.length, 'loaded marks')
    await until(() => calendar.querySelector('.abele-log__file-content')?.textContent.includes('Sample'), 'selected body')
    const selected = () => calendar.querySelector('.abele-calendar__day_selected')
    const dayTitle = () => calendar.querySelector('.abele-logs-calendar__day-title')
    report.today = selected().getAttribute('aria-label').includes(today.getDate() + ' ')
    report.dailyLink = !!dayTitle().querySelector('a.internal-link')
    const entryOf = path => [...calendar.querySelectorAll('.abele-log')].find(el => el.getAttribute('data-abele-anchor') === 'log:' + path)
    const dailyPath = folder + '/' + todayKey + '.md'
    report.noRepeatedSource = !entryOf(dailyPath).querySelector('.abele-log__links')
    report.ordinarySource = !!entryOf(ordinary.path)?.querySelector('.abele-log__links')
    report.marks = {
      checked: calendar.querySelectorAll('.abele-calendar__day-log_done').length,
      open: calendar.querySelectorAll('.abele-calendar__day-log_open').length,
      all: calendar.querySelectorAll('.abele-calendar__day-log').length
    }
    const monthBox = calendar.querySelector('.abele-logs-calendar__month').getBoundingClientRect()
    const detailBox = calendar.querySelector('.abele-logs-calendar__day').getBoundingClientRect()
    report.stacked = detailBox.top >= monthBox.bottom
    report.overflow = [...calendar.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > Math.min(innerWidth,calendar.getBoundingClientRect().right) + 1).map(el => el.className)
    report.daySizes = [...calendar.querySelectorAll('.abele-calendar__day')].map(el => { const b=el.getBoundingClientRect(); return [b.width,b.height] })
    await shoot('today')
    await shoot('busy-month')
    for (const [shape, path] of [['checkbox', dailyPath], ['ordinary', ordinary.path]]) {
      const entry = await until(() => entryOf(path), shape + ' entry')
      entry.scrollIntoView({ block: 'center' })
      const gallery = await until(() => entry.querySelector('.abele-gallery'), shape + ' entry gallery')
      gallery.scrollIntoView({ block: 'center' })
      await until(() => {
        const pictures = [...gallery.querySelectorAll('img')]
        return pictures.length === 3 && pictures.every(img => img.complete && img.naturalWidth > 0)
      }, shape + ' entry gallery pictures')
      report.galleryEntries.push({
        shape, path,
        pictures: gallery.querySelectorAll('img').length,
        source: store.galleriesContainers.value.some(g => g.filePath === path && g.images.length === 3),
        empty: gallery.textContent.includes('No pictures yet'),
        readonly: gallery.classList.contains('abele-gallery_readonly') && !gallery.querySelector('.abele-gallery__header'),
        outerHTML: entry.outerHTML,
      })
      saveEvidence()
      await shoot('gallery-entry-' + shape)
    }
    const title = calendar.querySelector('.abele-calendar__header-month-year')
    title.click()
    await until(() => calendar.querySelector('.abele-calendar-year'), 'footer year')
    await shoot('footer-year')
    report.footerYearSaved = app.loadLocalStorage('abele-footer-view')[note.path]?.logsYear === true
    title.click()
    await until(() => calendar.querySelector('.abele-calendar__days'), 'footer month')
    report.footerMonthSaved = !app.loadLocalStorage('abele-footer-view')[note.path]?.logsYear

    const sidebarMemory = app.loadLocalStorage('abele-sidebar-calendar-view')
    const sidebarLeaf = app.workspace.getLeaf('tab')
    try {
      await sidebarLeaf.setViewState({type:'abele-timeline-sidebar-view',active:true})
      const sidebar = await until(() => sidebarLeaf.view.containerEl.querySelector('.abele-timeline-sidebar__calendar'), 'sidebar calendar')
      const sidebarTitle = sidebar.querySelector('.abele-calendar__header-month-year')
      if (sidebar.querySelector('.abele-calendar-year')) { sidebarTitle.click(); await wait(100) }
      sidebarTitle.click()
      await until(() => sidebar.querySelector('.abele-calendar-year'), 'sidebar year')
      await shoot('sidebar-year')
      report.sidebarYearSaved = app.loadLocalStorage('abele-sidebar-calendar-view') === 'year'
      sidebarTitle.click()
      await until(() => sidebar.querySelector('.abele-calendar__days'), 'sidebar month')
      report.sidebarMonthSaved = app.loadLocalStorage('abele-sidebar-calendar-view') === 'month'
    } finally {
      sidebarLeaf.detach()
      app.saveLocalStorage('abele-sidebar-calendar-view', sidebarMemory)
      app.workspace.setActiveLeaf(leaf, { focus: true })
    }
    const todayFile = files.find(file => file.basename === todayKey)
    await app.vault.modify(todayFile, '---\ntype: log\ncreated: ' + todayKey + '\n---\n- [x] Sample entry for [[' + note.path + ']].\n')
    await until(() => selected().querySelector('.abele-calendar__day-log_done'), 'updated source checkbox mark')
    report.sourceRefresh = !!selected().querySelector('.abele-calendar__day-log_done')

    const longCell = [...calendar.querySelectorAll('.abele-calendar__day:not(.abele-calendar__day_other-month)')].find(el => el.querySelector('.abele-calendar__day-number').textContent === String(longDay))
    longCell.click()
    await until(() => calendar.querySelector('.abele-log__toggle'), 'long entry disclosure')
    report.collapsed = !!calendar.querySelector('.abele-log__file-content--collapsed')
    section.scrollIntoView({ block: 'start' })
    await shoot('long-entry')
    calendar.querySelector('.abele-log__toggle').click()
    await wait(100)
    report.expanded = !calendar.querySelector('.abele-log__file-content--collapsed')

    calendar.querySelector('[aria-label="Next month"]').click()
    await until(() => calendar.querySelector('.abele-logs-calendar__none')?.textContent.includes('Nothing written in'), 'empty month')
    report.empty = calendar.querySelector('.abele-logs-calendar__none').textContent.trim()
    report.selectedInMonth = !selected().classList.contains('abele-calendar__day_other-month')
    section.scrollIntoView({ block: 'start' })
    await shoot('empty-month')
    calendar.querySelector('[aria-label="Previous month"]').click()
    await until(() => calendar.querySelector('.abele-log__file-content')?.textContent.includes('Sample'), 'returned month body')
    report.returned = !calendar.querySelector('.abele-logs-calendar__none')
    await shoot('switching-months')
    calendar.querySelector('[aria-label="Select today"]').click()
    await wait(100)
    report.todayAgain = selected().querySelector('.abele-calendar__day-number').textContent === String(today.getDate())
    calendar.querySelector('.abele-calendar__day').focus()
    const contents = require('@electron/remote').getCurrentWebContents()
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' })
    await wait(100)
    const focused = document.activeElement
    const focusStyle = getComputedStyle(focused)
    report.keyboardDay = focused.classList.contains('abele-calendar__day') && focused.matches(':focus-visible')
    report.focusPaint = focusStyle.outlineStyle !== 'none' && parseFloat(focusStyle.outlineWidth) > 0 || focusStyle.boxShadow !== 'none'

    const saved = app.loadLocalStorage('abele-footer-view')
    report.saved = saved[note.path]?.logsCalendar === true
    root().querySelector('.abele-logs-list__view').click()
    await until(() => !root().querySelector('.abele-logs-calendar') && root().querySelector('.abele-logs-list__logs'), 'list view restored')
    report.list = !root().querySelector('.abele-logs-calendar') && !!root().querySelector('.abele-logs-list__logs')
    return report
  } finally {
    saveEvidence()
    api.rendering.MarkdownPreviewRenderer.unregisterPostProcessor(captureRendered)
    if (leaf === previousLeaf && previousViewState) await leaf.setViewState(previousViewState)
    else leaf?.detach()
    if (previousLeaf) app.workspace.setActiveLeaf(previousLeaf, { focus: true })
    const scratch = app.vault.getAbstractFileByPath(folder)
    if (scratch) await app.vault.delete(scratch, true)
    app.saveLocalStorage('abele-footer-view', previousMemory ?? {})
    config.rememberNotePlaces = previousRemember
    store.applySettings()
  }
})()`

async function check(label: string) {
  const raw = await evalLong(probe(label))
  if (raw.startsWith('Error:')) throw new Error(`${label} logs calendar: ${raw}`)
  const report = JSON.parse(raw)
  console.info(
    'Logs gallery renderer and fixed entry HTML (' +
      label +
      '): ' +
      JSON.stringify({ renderedHtml: report.renderedHtml, galleryEntries: report.galleryEntries })
  )
  expect(report.footerYearSaved).toBe(true)
  expect(report.footerMonthSaved).toBe(true)
  expect(report.sidebarYearSaved).toBe(true)
  expect(report.sidebarMonthSaved).toBe(true)
  expect(report.today).toBe(true)
  expect(report.dailyLink).toBe(true)
  expect(report.noRepeatedSource).toBe(true)
  expect(report.ordinarySource).toBe(true)
  expect(report.marks.checked).toBeGreaterThan(0)
  expect(report.marks.open).toBeGreaterThan(0)
  expect(report.marks.all).toBeGreaterThan(20)
  expect(report.stacked).toBe(label === 'phone')
  expect(report.overflow).toEqual([])
  if (label === 'phone') {
    for (const [width, height] of report.daySizes) {
      expect(width).toBeGreaterThanOrEqual(44)
      expect(height).toBeGreaterThanOrEqual(44)
    }
  }
  expect(report.sourceRefresh).toBe(true)
  expect(report.collapsed).toBe(true)
  expect(report.expanded).toBe(true)
  expect(report.empty).toMatch(/^Nothing written in /)
  expect(report.selectedInMonth).toBe(true)
  expect(report.returned).toBe(true)
  expect(report.todayAgain).toBe(true)
  expect(report.keyboardDay).toBe(true)
  expect(report.focusPaint).toBe(true)
  expect(report.saved).toBe(true)
  expect(report.list).toBe(true)
  expect(report.galleryEntries.map((entry) => entry.shape)).toEqual(['checkbox', 'ordinary'])
  for (const entry of report.galleryEntries) {
    expect(entry.pictures).toBe(3)
    expect(entry.source).toBe(true)
    expect(entry.empty).toBe(false)
    expect(entry.readonly).toBe(true)
    const parents = report.renderedHtml
      .filter((raw) => raw.sourcePath === entry.path)
      .flatMap((raw) => raw.markerParents)
    expect(parents).toContain(entry.shape === 'checkbox' ? 'LI' : 'P')
  }
}

describe.skipIf(!available)('logs calendar in the live note footer', () => {
  afterAll(async () => {
    if (emulated) await reloadApp('app.emulateMobile(false)')
    if (originalSize)
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${originalSize.width}, ${originalSize.height})`
      )
  })

  it('shows marked months and selected entries on a wide note', async () => {
    originalSize = JSON.parse(
      evalRaw(
        "JSON.stringify((() => { const [width,height] = require('@electron/remote').getCurrentWindow().getContentSize(); return {width,height} })())"
      )
    )
    evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(1440, 1000)")
    await check('desktop')
  }, 180_000)

  it('stacks the selected day under a full-width touch calendar on a phone', async () => {
    emulated = true
    await reloadApp('app.emulateMobile(true)')
    evalRaw("require('@electron/remote').getCurrentWindow().setContentSize(390, 844)")
    await check('phone')
  }, 180_000)
})
