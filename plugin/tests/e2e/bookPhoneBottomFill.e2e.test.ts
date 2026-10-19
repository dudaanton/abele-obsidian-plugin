/** Visible book paint must stop above the opaque phone bottom chrome. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  evalJson,
  evalLong,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  phoneEntry,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { buildProseEpub } from '../fixtures/books/proseBook'
import { onPhone, targets } from './helpers/target'
import { shotDir } from './helpers/shots'
import { WAIT_PRELUDE } from './helpers/wait'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const DIR = 'Sample reader bottom fill'
const SHOTS = shotDir('abele-phone')

interface Measurement {
  error?: string
  peek: boolean
  frameCount: number
  visiblePageBottom: number
  rowTop: number
  fillBottom: number
  viewportBottom: number
  opaque: boolean
}

describe.skipIf(!available)('phone reader bottom fill', () => {
  let size: number[] = []
  let wasZen = false
  beforeAll(async () => {
    wasZen = evalJson<boolean>('window.__abeleTest.reader.zen.state().on')
    if (!onPhone())
      size = evalJson<number[]>("require('@electron/remote').getCurrentWindow().getContentSize()")
    evalRaw(`(async () => {
      window.__abeleTest.reader.zen.set(false)
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      if (!app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})) await app.vault.createFolder(${JSON.stringify(DIR)})
      const bytes = Uint8Array.from(atob(${JSON.stringify(Buffer.from(buildProseEpub()).toString('base64'))}), c => c.charCodeAt(0))
      await app.vault.createBinary(${JSON.stringify(DIR + '/sample.epub')}, bytes.buffer)
      return 'ok'
    })()`)
    await reloadApp(phoneEntry(390, 844))
    if (!onPhone()) {
      runCli(['dev:debug', 'on'])
      evalRaw("document.body.style.setProperty('--safe-area-inset-bottom', '34px')")
    }
  }, 120_000)

  afterAll(async () => {
    if (!available) return
    evalRaw(`(async () => {
      for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
      window.__abeleTest.reader.zen.set(${wasZen})
      const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (dir) await app.vault.delete(dir, true)
      ${onPhone() ? '' : `require('@electron/remote').getCurrentWindow().setContentSize(${size[0]}, ${size[1]})`}
      return 'ok'
    })()`)
    if (!onPhone()) await reloadApp('app.emulateMobile(false)')
  }, 120_000)

  it.each([false, true])(
    'fills below the row and clips the page, zen=%s',
    async (zen) => {
      const result = JSON.parse(
        await evalLong(
          `(async () => {
      ${WAIT_PRELUDE}
      try {
        let leaf = app.workspace.getLeavesOfType('abele-book')[0]
        if (!leaf) {
          leaf = app.workspace.getLeaf('tab')
          await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(DIR + '/sample.epub')} }, active: true })
        }
        const view = leaf.view
        if (!await until(() => view.model?.status === 'ready' && view.engine.renderer?.getContents()[0]?.doc?.fonts.status === 'loaded')) throw Error('book not ready')
        view.model.panel = false
        if (window.__abeleTest.reader.zen.state().on !== ${zen}) app.commands.executeCommandById('abele:reader-toggle-zen')
        const stage = view.contentEl.querySelector('.abele-book-reader__stage')
        if (${zen}) {
          if (!await until(() => !view.model.zenPeek && document.body.classList.contains('is-hidden-nav'))) throw Error('zen not hidden')
          const r = stage.getBoundingClientRect()
          if (window.__e2eHost) await window.__e2eHost.tap(r.x + r.width / 2, r.y + r.height / 2)
          else {
            const cdp = require('@electron/remote').getCurrentWebContents().debugger
            await cdp.sendCommand('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:r.x+r.width/2,y:r.y+r.height/2,id:0}]})
            await wait(60)
            await cdp.sendCommand('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]})
          }
          if (!await until(() => view.model.zenPeek)) throw Error('centre tap did not reveal chrome')
        }
        if (!await until(() => !view.containerEl.getAnimations({subtree:true}).some(a => a.playState === 'running'))) throw Error('chrome did not settle')
        const foot = view.contentEl.querySelector('.abele-book-reader__foot')
        const row = foot.getBoundingClientRect()
        // Intersect iframe paint with each ancestor's clip, including shadow hosts.
        // Zen retains its page layout underneath the chrome, avoiding a relocation on peek.
        const frames = view.engine.renderer.getContents().map(c => c.doc.defaultView.frameElement)
        const bottoms = frames.map(frame => {
          let bottom = frame.getBoundingClientRect().bottom
          for (let el = frame; el; el = el.parentElement || el.getRootNode().host) {
            const css = getComputedStyle(el), box = el.getBoundingClientRect()
            if (['hidden','clip','scroll','auto'].includes(css.overflowY)) bottom = Math.min(bottom, box.bottom)
            const inset = /^inset\\(0px 0px ([0-9.]+)px\\)/.exec(css.clipPath)
            if (inset) bottom = Math.min(bottom, box.bottom - Number(inset[1]))
          }
          return bottom
        })
        const solid = color => /^rgb\\(/.test(color) || /^rgba\\([^,]+,[^,]+,[^,]+, 1\\)$/.test(color)
        const css = getComputedStyle(foot)
        const out = { peek: view.model.zenPeek, frameCount: frames.length,
          visiblePageBottom: Math.max(...bottoms), rowTop: row.top, fillBottom: row.bottom,
          viewportBottom: innerHeight, opaque: solid(css.backgroundColor) && css.opacity === '1' }
        const shot = ${JSON.stringify(SHOTS)} + '/bottom-fill-' + (${zen} ? 'zen-on' : 'zen-off') + '.png'
        if (window.__e2eHost) await window.__e2eHost.shot(shot)
        else {
          const image = await require('@electron/remote').getCurrentWebContents().capturePage()
          require('fs').writeFileSync(shot, image.toPNG())
        }
        // Outside zen the host navbar owns the area below the reader.
        if (!${zen}) {
          const viewCss = getComputedStyle(view.contentEl)
          out.fillBottom = view.contentEl.getBoundingClientRect().bottom
          out.opaque = out.opaque && solid(viewCss.backgroundColor)
        }
        return out
      } catch (e) { return { error: String(e) } }
    })()`,
          120_000
        )
      ) as Measurement
      expect(result.error).toBeUndefined()
      expect(result.peek).toBe(zen)
      expect(result.frameCount).toBeGreaterThan(0)
      expect(result.opaque).toBe(true)
      expect(result.visiblePageBottom).toBeLessThanOrEqual(result.rowTop + 1)
      expect(result.fillBottom).toBeGreaterThanOrEqual(result.viewportBottom - 1)
    },
    120_000
  )
})
