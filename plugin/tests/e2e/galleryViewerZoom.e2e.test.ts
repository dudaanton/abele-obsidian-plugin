import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalRaw, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { WAIT_PRELUDE } from './helpers/wait'
import { withNativeInput } from './helpers/nativeInput'
import { shotDir } from './helpers/shots'

const DIR = 'GalleryZoomE2E'
const NOTE = `${DIR}/sample-gallery.md`
const PICTURE = `${DIR}/sample-picture.png`
const SHOTS = shotDir('gallery-zoom')
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('shared gallery viewer', () => {
  beforeAll(() => {
    evalAsync(`(async () => {
      await app.vault.createFolder(${JSON.stringify(DIR)})
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#c9ddec'; ctx.fillRect(0, 0, 640, 400)
      ctx.fillStyle = '#235777'; ctx.fillRect(100, 80, 440, 240)
      ctx.fillStyle = '#ffffff'; ctx.font = '32px sans-serif'; ctx.fillText('Sample picture', 190, 210)
      const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), (ch) => ch.charCodeAt(0))
      await app.vault.createBinary(${JSON.stringify(PICTURE)}, bytes.buffer)
      await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(`::abele-gallery::\n![[${PICTURE}]]\n`)})
      return true
    })()`)
  })
  afterAll(async () => {
    evalRaw(
      `document.querySelector('.abele-gallery-viewer')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))`
    )
    await reloadApp('app.emulateMobile(false)')
    evalAsync(`(async () => {
      for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf.view.file?.path === ${JSON.stringify(NOTE)}) leaf.detach()
      const folder = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (folder) await app.vault.delete(folder, true)
      return true
    })()`)
  })
  for (const phone of [false, true]) {
    it(`zooms and keeps native dialog controls on ${phone ? 'phone' : 'desktop'}`, async () => {
      if (phone) {
        await reloadApp('app.emulateMobile(true)')
        evalRaw(`require('@electron/remote').getCurrentWindow().setContentSize(390, 844)`)
      }
      const report = await withNativeInput(() =>
        evalAsync<{
          before: number
          after: number
          shell: boolean
          controls: string[]
          width: number
          height: number
          themed: boolean
        }>(`(async () => {
        ${WAIT_PRELUDE}
        const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
        const leaf = app.workspace.getLeaf(false)
        await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'preview' }, active: true })
        app.workspace.revealLeaf(leaf)
        const picture = await until(() => leaf.view.containerEl.querySelector('.markdown-preview-view .abele-gallery img'))
        if (!picture) throw Error('No gallery picture')
        picture.scrollIntoView({ block: 'center' })
        await until(() => picture.complete && picture.naturalWidth)
        picture.click()
        const image = await until(() => document.querySelector('.abele-gallery-viewer__image'))
        if (!image) throw Error('No viewer')
        await until(() => image.complete && image.naturalWidth)
        const frame = image.parentElement
        const box = frame.getBoundingClientRect()
        const scale = () => Number(/scale\\(([^)]+)\\)/.exec(image.style.transform)?.[1])
        const before = scale()
        if (${phone}) {
          const debug = require('@electron/remote').getCurrentWebContents().debugger
          const own = !debug.isAttached()
          if (own) debug.attach('1.3')
          const cx = box.left + box.width / 2; const cy = box.top + box.height / 2
          const points = (spread) => [{ id: 1, x: cx - spread, y: cy }, { id: 2, x: cx + spread, y: cy }]
          try {
            await debug.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(35) })
            await debug.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(70) })
            await debug.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          } finally { if (own) debug.detach() }
        } else frame.dispatchEvent(new WheelEvent('wheel', { deltaY: -300, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, cancelable: true }))
        if (!await until(() => scale() > before * 1.5)) throw Error('Zoom did not respond')
        const after = scale()
        const root = image.closest('.abele-gallery-viewer')
        const controls = [...root.querySelectorAll('.abele-gallery-viewer__toolbar .abele-obsidian-icon')].map((el) => el.textContent.trim())
        const probe = document.createElement('div'); probe.style.backgroundColor = 'var(--background-secondary)'; document.body.appendChild(probe)
        const themed = getComputedStyle(frame).backgroundColor === getComputedStyle(probe).backgroundColor
        probe.remove()
        const shot = await require('@electron/remote').getCurrentWebContents().capturePage()
        require('fs').writeFileSync(${JSON.stringify(SHOTS + (phone ? '/phone.png' : '/desktop.png'))}, shot.resize({ width: ${phone ? 390 : 1280} }).toPNG())
        const shell = !!root.closest('.abele-modal_full')?.querySelector('.modal-close-button, .modal-header-button.mod-raised')
        root.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        await until(() => !document.querySelector('.abele-gallery-viewer'))
        return { before, after, shell, controls, width: innerWidth, height: innerHeight, themed }
      })()`)
      )
      expect(report.after).toBeGreaterThan(report.before * 1.5)
      expect(report.shell).toBe(true)
      expect(report.controls).toEqual(
        expect.arrayContaining(['Copy', 'Path', 'Draw', 'Rotate', 'More'])
      )
      expect(report.themed).toBe(true)
      if (phone) expect([report.width, report.height]).toEqual([390, 844])
    })
  }
})
