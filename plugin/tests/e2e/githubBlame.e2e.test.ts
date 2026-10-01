/** File blame at 390 px and on the real phone: virtual rows, details, navigation and no overflow. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import {
  enableGithub,
  evalAsync,
  PRELUDE,
  restoreGithub,
  startFakeGithub,
  type FakeGithub,
} from './helpers/githubLive'
import { onPhone, targets } from './helpers/target'
import { longPress } from './helpers/phone'
import { shotDir } from './helpers/shots'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const SHOTS = shotDir('abele-phone')

describe.skipIf(!available)('file blame on a phone', () => {
  let gh: FakeGithub
  let size: [number, number] | undefined
  beforeAll(async () => {
    gh = await startFakeGithub()
    if (!onPhone()) {
      size = evalJson(`[...require('@electron/remote').getCurrentWindow().getContentSize()]`)
      await reloadApp('app.emulateMobile(true)')
      evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      await reloadApp('window.location.reload()')
    }
    enableGithub(gh.origin, false)
  }, 180_000)
  afterAll(async () => {
    try {
      restoreGithub()
    } finally {
      gh?.stop()
    }
    if (size) {
      evalRaw(
        `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`
      )
      await reloadApp('app.emulateMobile(false)')
    }
  }, 120_000)

  it('fits the phone layout, draws only visible attribution and keeps line selection working', () => {
    const report = evalAsync<{
      phone: boolean
      width: number
      sideways: number
      gutterWidth: number
      headers: number
      selected: boolean
      aligned: boolean
      shot: string
    }>(`(async () => {
      ${PRELUDE}
      const leaf = await openTab(${JSON.stringify(`${gh.web}/blob/main/src/long.ts`)})
      const root = leaf.view.containerEl
      const toggle = await until(() => root.querySelector('button[aria-label="Toggle line blame"]'))
      if (!toggle) throw Error('No blame toggle')
      toggle.click()
      if (!(await until(() => root.querySelector('.abele-github-blame-range__open')))) throw Error('No attribution')
      // Wait for CodeMirror's measurement after the teleported range labels arrive.
      let previous = ''
      if (!(await until(() => {
        const rects = JSON.stringify([...root.querySelectorAll('.cm-line, .abele-github-blame-range')].map(e => {
          const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]
        }))
        const same = rects === previous; previous = rects; return same
      }))) throw Error('Layout did not settle')
      const editor = root.querySelector('.cm-editor')
      const gutter = root.querySelector('.abele-github-blame')
      const first = root.querySelector('.abele-github-blame-range')
      const line = root.querySelector('.cm-line')
      const numbers = root.querySelectorAll('.cm-lineNumbers .cm-gutterElement')
      const number = [...numbers].find(e => e.textContent === '2')
      number.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))
      number.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }))
      await until(() => root.querySelector('.abele-github-code__line_target'))
      const path = ${JSON.stringify(`${SHOTS}/github-blame.png`)}
      if (window.__e2eHost) await window.__e2eHost.shot(path)
      else {
        require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
        const image = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(path, image.toPNG())
      }
      return {
        phone: document.body.classList.contains('is-phone'), width: innerWidth,
        sideways: root.scrollWidth - root.clientWidth,
        gutterWidth: gutter.getBoundingClientRect().width,
        headers: root.querySelectorAll('.abele-github-blame-range').length,
        selected: !!root.querySelector('.abele-github-code__line_target'),
        aligned: Math.abs(first.getBoundingClientRect().top - line.getBoundingClientRect().top) < 3,
        shot: path,
      }
    })()`)
    console.info(JSON.stringify(report))
    expect(report.phone).toBe(true)
    if (!onPhone()) expect(report.width).toBe(390)
    expect(report.sideways).toBe(0)
    expect(report.gutterWidth).toBeGreaterThan(60)
    expect(report.gutterWidth).toBeLessThan(160)
    expect(report.headers).toBeGreaterThan(0)
    expect(report.headers).toBeLessThan(100)
    expect(report.selected).toBe(true)
    expect(report.aligned).toBe(true)
    expect(report.shot).toMatch(/\.png$/)
  })

  it('shows full details on a long press and opens the range commit in the same tab', () => {
    const at = evalAsync<{ x: number; y: number }>(`(async () => {
      ${PRELUDE}
      const button = githubLeaves()[0].view.containerEl.querySelector('.abele-github-blame-range__open')
      button.scrollIntoView({ block: 'center' })
      if (!(await until(() => placeInView(button).inView))) throw Error('Range not visible')
      const r = button.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    if (onPhone()) longPress(at.x, at.y)
    else
      evalRaw(`(() => {
      const button = document.elementFromPoint(${at.x}, ${at.y}).closest('button')
      button.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', button: 0, clientX: ${at.x}, clientY: ${at.y}, bubbles: true }))
      return 'pressed'
    })()`)
    const result = evalAsync<{
      details: string
      sameLeaf: boolean
      url: string
      sideways: number
    }>(`(async () => {
      ${PRELUDE}
      const modal = await until(() => document.querySelector('.modal:has(.abele-github-blame-details)'))
      if (!modal) throw Error('Long press did not show details')
      const details = modal.textContent
      if (!(await until(() => modal.getBoundingClientRect().height > 0))) throw Error('Details not laid out')
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const shot = ${JSON.stringify(`${SHOTS}/github-blame-details.png`)}
      if (window.__e2eHost) await window.__e2eHost.shot(shot)
      else {
        const image = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(shot, image.toPNG())
      }
      const content = modal.querySelector('.modal-content')
      const sideways = content.scrollWidth - content.clientWidth
      const leaf = githubLeaves()[0]
      const open = [...modal.querySelectorAll('button')].find(b => b.textContent === 'Open commit')
      open.click()
      if (!(await until(() => leaf.view.model.url.includes('/commit/') && !document.querySelector('.abele-github-blame-details')))) throw Error('Commit did not open')
      return { details, sideways, sameLeaf: githubLeaves()[0] === leaf, url: leaf.view.model.url }
    })()`)
    expect(result.sideways).toBe(0)
    expect(result.details).toContain('Full sample explanation for this range.')
    expect(result.details).toContain('4 Mar 2025')
    expect(result.sameLeaf).toBe(true)
    expect(result.url).toContain('/commit/')
  })

  it('draws attribution near a linked line far down the file without expanding every range', () => {
    const report = evalAsync<{ marked: boolean; lateRange: boolean; count: number }>(`(async () => {
      ${PRELUDE}
      const leaf = githubLeaves()[0]
      await leaf.setViewState({ type: 'abele-github', state: { url: ${JSON.stringify(`${gh.web}/blob/main/src/long.ts#L350`)} }, active: true })
      const root = leaf.view.containerEl
      if (!(await until(() => root.querySelector('.abele-github-code__line_target')?.textContent.includes('setting350')))) throw Error('Linked line missing')
      root.querySelector('button[aria-label="Toggle line blame"]').click()
      if (!(await until(() => [...root.querySelectorAll('.abele-github-blame-range')].some(e => e.textContent.includes('Sample attribution 88'))))) throw Error('Late attribution missing')
      return {
        marked: placeInView(root.querySelector('.abele-github-code__line_target')).inView,
        lateRange: [...root.querySelectorAll('.abele-github-blame-range')].some(e => e.textContent.includes('Sample attribution 88')),
        count: root.querySelectorAll('.abele-github-blame-range').length,
      }
    })()`)
    expect(report.marked).toBe(true)
    expect(report.lateRange).toBe(true)
    expect(report.count).toBeLessThan(100)
  })
})
