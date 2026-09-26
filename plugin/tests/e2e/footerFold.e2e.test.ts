/**
 * Folding the lists under a note, in the running app, on the scale vault.
 *
 * A long list under a note grows a page every time the scroll reaches its end, so whatever sits
 * below it could never be scrolled to. The component tier proves each list folds and that the
 * fold is remembered. What only the app can show is that folding the lists above the logs really
 * brings the logs up, that the fold survives leaving the note and coming back, that the keyboard
 * reaches it, and what the headings look like on a desktop and at a phone's width.
 *
 * Pictures go to `/tmp/abele-phone/footer-fold-*.png`; look at them. They are never committed.
 * Every fold it makes it takes back. Requires Obsidian running on the e2e fixture vault with the
 * development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  activeVaultName,
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  setBackgroundThrottling,
} from './helpers/obsidianCli'

const GROUP_NOTE = process.env.OBSIDIAN_TEST_GROUP ?? 'ScaleTest/Notes/Projects.md'
const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-phone'

interface Report {
  /** The titles of the foldable lists, top to bottom. */
  lists: string[]
  /** Headings that are not a focusable button saying it is open, before anything is folded. */
  notButtons: string[]
  /** Pixels from the top of the footer to the logs, before and after folding the rest. */
  logsBefore: number
  logsAfter: number
  /** Lists that still show more than their header row once folded. */
  leftOpen: string[]
  /** The counts the folded headings show. */
  counts: string[]
  /** Folded lists that were open again after leaving the note and coming back. */
  forgotten: string[]
  /** aria-expanded after Enter, then after Space, on a folded heading. */
  keyboard: string[]
  /** Height of a heading's row, in pixels. */
  headingHeight: number
  /** Elements of the footer past the right edge of the window. */
  over: string[]
  /** Headings still folded after the run put everything back. */
  leftFolded: string[]
  shots: string[]
  error: string
}

const probeScript = (tag: string): string => `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      if (fn()) return true
      await wait(50)
    }
    return false
  }
  const fs = require('fs')
  const win = require('@electron/remote').getCurrentWindow()
  fs.mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
  const report = { lists: [], notButtons: [], logsBefore: 0, logsAfter: 0, leftOpen: [], counts: [], forgotten: [], keyboard: [], headingHeight: 0, over: [], leftFolded: [], shots: [], error: '' }

  let nudged = false
  const shoot = async (label) => {
    // The first capture after a reload can hang until the window produces a frame; a nudge of
    // its size makes one. See taskDatePhone.e2e.test.ts.
    if (!nudged) {
      nudged = true
      const [w, h] = win.getContentSize()
      win.setContentSize(w + 2, h + 2)
      await wait(300)
      win.setContentSize(w, h)
    }
    await wait(400)
    let img
    try {
      img = await win.webContents.capturePage()
    } catch (error) {
      if (!String(error && error.message).includes('UnknownVizError')) throw error
      await wait(300)
      img = await win.webContents.capturePage()
    }
    const path = ${JSON.stringify(SHOTS)} + '/footer-fold-${tag}-' + label + '.png'
    fs.writeFileSync(path, img.toPNG())
    report.shots.push(path)
  }

  const leaf = app.workspace.getLeaf(false)
  const footer = () => leaf.view.containerEl.querySelector('.abele-footer-view')
  const openNote = async (path) => {
    await leaf.openFile(app.vault.getAbstractFileByPath(path))
    await until(() => footer() && footer().querySelector('.abele-logs-list'), 30000)
    await wait(1500)
  }
  const headings = () => [...footer().querySelectorAll('.abele-fold-heading')]
  const titleOf = (h) => h.querySelector('.abele-fold-heading__text').textContent.trim()
  const listOf = (h) => h.closest('.abele-footer-view > *')
  const headingFor = (title) => headings().find((h) => titleOf(h) === title)
  const logs = () => footer().querySelector('.abele-logs-list')
  const logsTop = () => Math.round(logs().getBoundingClientRect().top - footer().getBoundingClientRect().top)

  try {
    await openNote(${JSON.stringify(GROUP_NOTE)})
    report.lists = headings().map(titleOf)
    report.notButtons = headings()
      .filter((h) => h.getAttribute('role') !== 'button' || h.tabIndex !== 0 || h.getAttribute('aria-expanded') !== 'true')
      .map(titleOf)
    const first = headings()[0]
    report.headingHeight = Math.round(first.parentElement.getBoundingClientRect().height)
    report.logsBefore = logsTop()

    footer().scrollIntoView({ block: 'start' })
    await shoot('open')

    // Everything above the logs folds; the logs come up to just under their headers.
    const above = headings().filter((h) => logs().compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING)
    for (const h of above) {
      h.click()
      await wait(150)
    }
    await wait(500)
    report.logsAfter = logsTop()
    for (const h of above) {
      const title = titleOf(h)
      const now = headingFor(title)
      if (now.getAttribute('aria-expanded') !== 'false' || listOf(now).children.length !== 1) report.leftOpen.push(title)
      report.counts.push(title + ' ' + (now.querySelector('.abele-fold-heading__count')?.textContent ?? '-'))
    }
    const r = footer().getBoundingClientRect()
    for (const el of [footer(), ...footer().querySelectorAll('.abele-fold-heading, [class$="__header"] *')]) {
      const b = el.getBoundingClientRect()
      if (b.width && b.right > Math.min(window.innerWidth, r.right) + 0.5)
        report.over.push(((el.className || el.tagName) + '').split(' ')[0] + ' +' + Math.round(b.right - r.right))
    }
    footer().scrollIntoView({ block: 'start' })
    await shoot('folded')

    // Away and back: the note opens with the same lists folded.
    const other = app.vault.getMarkdownFiles().find((f) => f.path.startsWith('ScaleTest/') && f.path !== ${JSON.stringify(GROUP_NOTE)})
    await leaf.openFile(other)
    await wait(1500)
    await openNote(${JSON.stringify(GROUP_NOTE)})
    for (const h of above) {
      const title = titleOf(h)
      if (headingFor(title)?.getAttribute('aria-expanded') !== 'false') report.forgotten.push(title)
    }

    // The keyboard: Enter opens the first folded list, Space folds it again.
    const key = (h, k) => h.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
    const firstTitle = titleOf(headings()[0])
    headingFor(firstTitle).focus()
    key(headingFor(firstTitle), 'Enter')
    await wait(300)
    report.keyboard.push(headingFor(firstTitle).getAttribute('aria-expanded'))
    key(headingFor(firstTitle), ' ')
    await wait(300)
    report.keyboard.push(headingFor(firstTitle).getAttribute('aria-expanded'))
  } catch (e) {
    report.error = String((e && e.stack) || e)
  } finally {
    // Leaves the vault as it found it: every list open.
    try {
      for (const h of headings()) if (h.getAttribute('aria-expanded') === 'false') { h.click(); await wait(150) }
      await wait(300)
      report.leftFolded = headings().filter((h) => h.getAttribute('aria-expanded') === 'false').map(titleOf)
    } catch (e) {
      report.error += ' cleanup: ' + String(e)
    }
  }
  return report
})()`

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(
    `require('@electron/remote').getCurrentWindow().getContentSize()`,
    30_000
  )

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await new Promise((resolve) => setTimeout(resolve, 1500))
}

/** Detached and polled: one CLI call gives up after 45 seconds. */
const run = async (tag: string): Promise<Report> => {
  const started = evalRaw(
    `(() => {
      window.__abeleFooterFold = null;
      ${probeScript(tag)}.then(
        (r) => { window.__abeleFooterFold = r },
        (e) => { window.__abeleFooterFold = { error: String((e && e.message) || e) } }
      )
      return 'started'
    })()`,
    30_000
  )
  if (!started.includes('started')) throw new Error(`the ${tag} probe did not start: ${started}`)
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    const report = evalJson<Report | null>('window.__abeleFooterFold ?? null', 30_000)
    if (report) return report
  }
  throw new Error(`the ${tag} probe did not finish`)
}

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('folding the lists under a note', () => {
  let desktop = {} as Report
  let phone = {} as Report
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    setBackgroundThrottling(false)
    desktop = await run('desktop')

    size = windowSize()
    await reloadApp('app.emulateMobile(true)')
    await setWindowSize(PHONE.width, PHONE.height)
    // A resize leaves the viewport stale until the app reloads.
    await reloadApp()
    phone = await run('phone')

    console.info(
      `\n  vault ${activeVaultName()}\n` +
        [desktop, phone]
          .map(
            (r, i) =>
              `  ${i ? 'phone  ' : 'desktop'} lists=${r.lists?.join('/')} logs ${r.logsBefore}->${r.logsAfter}px` +
              ` heading=${r.headingHeight}px counts=${r.counts?.join(', ')}\n    ${r.shots?.join('\n    ')}`
          )
          .join('\n') +
        '\n'
    )
  }, 400_000)

  afterAll(async () => {
    if (!available) return
    if (size[0]) await setWindowSize(size[0], size[1])
    await reloadApp('app.emulateMobile(false)')
    setBackgroundThrottling(true)
  }, 120_000)

  const both = (): Array<[string, Report]> => [
    ['desktop', desktop],
    ['phone', phone],
  ]

  it('runs through on both layouts', () => {
    for (const [label, r] of both()) expect(r.error, label).toBe('')
  })

  it('gives every list under the note a heading that folds', () => {
    for (const [label, r] of both()) {
      expect(r.lists, label).toEqual(expect.arrayContaining(['Backlinks', 'Logs']))
      expect(r.notButtons, label).toEqual([])
    }
  })

  it('brings the logs up once the lists above them are folded', () => {
    for (const [label, r] of both()) {
      expect(r.logsBefore, label).toBeGreaterThan(1500)
      expect(r.leftOpen, label).toEqual([])
      // Only the folded header rows are left above the logs.
      expect(r.logsAfter, label).toBeLessThan(r.lists.length * 80)
      for (const c of r.counts) expect(c, label).toMatch(/ \d+$/)
    }
  })

  it('keeps the fold when the note is left and opened again', () => {
    for (const [label, r] of both()) expect(r.forgotten, label).toEqual([])
  })

  it('opens and folds from the keyboard', () => {
    for (const [label, r] of both()) expect(r.keyboard, label).toEqual(['true', 'false'])
  })

  it('fits the width, with a heading tall enough to tap on a phone', () => {
    for (const [label, r] of both()) expect(r.over, label).toEqual([])
    expect(phone.headingHeight).toBeGreaterThanOrEqual(24)
  })

  it('puts every list back open', () => {
    for (const [label, r] of both()) expect(r.leftFolded, label).toEqual([])
  })
})
