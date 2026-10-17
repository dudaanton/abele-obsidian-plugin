import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { enterPhone, hasTestApi, isObsidianRunning, reloadApp } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const directory = 'Sample crop check'
const shots = shotDir('picture-crop')
const heic = readFileSync(
  new URL('../fixtures/images/sample-gradient.heic', import.meta.url)
).toString('base64')

describe.skipIf(!available)('picture crop from the viewer', () => {
  const cleanup = () =>
    evalAsync<boolean>(
      `(async () => {
    for (const leaf of app.workspace.getLeavesOfType('abele-image-ink'))
      if (leaf.view.getState().path?.startsWith(${JSON.stringify(directory + '/')})) leaf.detach()
    const folder = app.vault.getAbstractFileByPath(${JSON.stringify(directory)})
    if (folder) await app.vault.delete(folder, true)
    return true
  })()`,
      60000
    )
  beforeAll(() => {
    cleanup()
  }, 90000)
  afterAll(async () => {
    cleanup()
    await reloadApp('app.emulateMobile(false)')
  })

  for (const phone of [false, true])
    it(`crops and saves full resolution (${phone ? 'phone' : 'desktop'})`, async () => {
      if (phone) await enterPhone()
      const result = evalAsync<{ size: number[]; original: number[]; error?: string }>(
        `(async () => {
      const wait = (ms) => new Promise(r => setTimeout(r, ms))
      const until = async (fn) => { for (let i = 0; i < 160; i++) { const result = fn(); if (result) return result; await wait(50) } throw Error('Timed out') }
      const dir = ${JSON.stringify(directory)}
      const path = dir + '/sample-${phone ? 'phone' : 'desktop'}.png'
      const screenshot = async (name) => {
        await wait(200)
        const wc = require('@electron/remote').getCurrentWebContents()
        const image = await wc.capturePage()
        require('fs').mkdirSync(${JSON.stringify(shots)}, { recursive: true })
        require('fs').writeFileSync(${JSON.stringify(shots)} + '/${phone ? 'phone' : 'desktop'}-' + name + '.png', image.toPNG())
      }
      try {
        if (!app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir)
        const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#3978bd'; ctx.fillRect(0, 0, 800, 600)
        ctx.fillStyle = '#f1c344'; ctx.fillRect(0, 0, 400, 300)
        const blob = await new Promise(r => canvas.toBlob(r))
        const original = await app.vault.createBinary(path, await blob.arrayBuffer())
        await window.__abeleTest.previewImage(path)
        const crop = await until(() => document.querySelector('.abele-gallery-viewer__toolbar [aria-label="Crop, turn or mirror this picture"]'))
        await screenshot('viewer'); crop.click()
        const view = await until(() => app.workspace.getLeavesOfType('abele-image-ink').map(l => l.view).find(v => v.session && v.editor.width))
        await until(() => view.contentEl.querySelector('.abele-crop-frame'))
        await screenshot('crop-open')
        const narrowShot = async (name) => {
          const pane = view.containerEl.closest('.workspace-leaf')
          const prior = pane.getAttribute('style')
          try {
            pane.style.width = '500px'; pane.style.maxWidth = '500px'; pane.style.flex = '0 0 500px'
            await wait(250)
            view.fitPicture()
            const bar = view.contentEl.querySelector('.abele-picture-editor__bar')
            const center = (el) => { const r = el.getBoundingClientRect(); return r.y + r.height / 2 }
            const rows = []
            for (const button of bar.querySelectorAll('button'))
              if (!rows.some(y => Math.abs(y - center(button)) < 3)) rows.push(center(button))
            await screenshot(name)
            if (Math.abs(bar.getBoundingClientRect().width - 500) > 4) throw Error('Narrow pane was not 500px')
            if (rows.length !== 2) throw Error('Narrow toolbar has ' + rows.length + ' rows')
            const primary = bar.querySelector('.abele-picture-editor__primary')
            const cancel = primary.querySelector('button')
            const save = primary.querySelector('.abele-picture-editor__save button')
            for (const button of primary.querySelectorAll('button'))
              if (Math.abs(center(button) - center(cancel)) > 3) throw Error('Primary controls wrapped')
            const pinned = () => {
              const bounds = bar.getBoundingClientRect()
              if (cancel.getBoundingClientRect().left < bounds.left || save.getBoundingClientRect().right > bounds.right)
                throw Error('Cancel or Save escaped the pane')
            }
            pinned()
            if (!view.containerEl.querySelector('.view-header-title')?.textContent.includes(original.name)) throw Error('Header lacks picture filename')
            pane.style.width = '300px'; pane.style.maxWidth = '300px'; pane.style.flex = '0 0 300px'
            await wait(100)
            pinned()
            const tools = primary.querySelector('.abele-picture-editor__desktop-tools')
            if (tools.scrollWidth <= tools.clientWidth || getComputedStyle(tools).overflowX !== 'auto')
              throw Error('Very narrow tools do not scroll')
          } finally {
            if (prior === null) pane.removeAttribute('style'); else pane.setAttribute('style', prior)
            await wait(250)
            view.fitPicture()
          }
        }
        if (!${phone}) await narrowShot('narrow-crop-open')
        const wc = require('@electron/remote').getCurrentWebContents()
        const handle = view.contentEl.querySelector('.abele-crop-frame__handle_se').getBoundingClientRect()
        const start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
        if (${phone}) {
          await wc.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 0 }] })
          await wc.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x - 24, y: start.y - 24, id: 0 }] })
          await wc.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        } else {
          await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 })
          await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: start.x - 24, y: start.y - 24, button: 'left', buttons: 1 })
          await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x - 24, y: start.y - 24, button: 'left', buttons: 0, clickCount: 1 })
        }
        await wait(100)
        if (view.editor.crop.rect.w >= 1) throw Error('Crop handle did not resize the frame')
        const click = (label) => { const el = view.contentEl.querySelector('[aria-label="' + label + '"]'); if (!el) throw Error('Missing ' + label); el.click() }
        click('Undo'); await wait(100)
        if (view.editor.crop.rect.w !== 1) throw Error('Undo did not restore the frame')
        if (${phone}) {
          const box = view.contentEl.querySelector('.abele-crop-frame').getBoundingClientRect()
          const mx = box.x + box.width / 2, my = box.y + box.height / 2
          const beforeZoom = view.model.zoom, beforeFrame = JSON.stringify(view.editor.crop.rect)
          await wc.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mx - 30, y: my, id: 0 }, { x: mx + 30, y: my, id: 1 }] })
          await wc.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mx - 50, y: my + 10, id: 0 }, { x: mx + 70, y: my + 10, id: 1 }] })
          await wc.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          await wait(100)
          if (view.model.zoom <= beforeZoom) throw Error('Two fingers did not zoom the picture')
          if (JSON.stringify(view.editor.crop.rect) !== beforeFrame) throw Error('Two fingers resized the crop frame')
          view.contentEl.querySelector('.abele-picture-editor__zoom').click(); await wait(100)
        }
        click('Square'); await screenshot('crop-square')
        click('4:3, and 3:4 when picked again'); click('4:3, and 3:4 when picked again'); await screenshot('crop-tall')
        click('Turn a quarter to the left'); await screenshot('crop-turned')
        view.editor.crop.rect = { x: 0, y: 0, w: 0.5, h: 0.5 }
        await screenshot('before-done')
        click('Pen'); await wait(100)
        const surface = view.contentEl.querySelector('.abele-picture-session')
        if (!surface.style.clipPath.startsWith('polygon(')) throw Error('Done still shows the whole source')
        const sw = view.editor.crop.turns % 2 ? view.editor.height : view.editor.width
        const sh = view.editor.crop.turns % 2 ? view.editor.width : view.editor.height
        const expectedZoom = Math.max(0.001, Math.min(20,
          Math.max(1, view.session.surface.width - 64) / (sw * 0.5),
          Math.max(1, view.session.surface.height - 64) / (sh * 0.5)))
        if (Math.abs(view.model.zoom - expectedZoom) > 0.001) throw Error('Done did not fit the kept region')
        await screenshot('after-done')
        click('Crop, turn or mirror the picture'); await wait(100)
        if (surface.style.clipPath) throw Error('Re-entering crop hid the source')
        if (view.editor.crop.rect.w !== 0.5) throw Error('Re-entering crop lost the frame')
        await screenshot('crop-reentered')
        const made = await view.saveNew(original)
        const bytes = await app.vault.readBinary(made)
        const bitmap = await createImageBitmap(new Blob([bytes]))
        const size = [bitmap.width, bitmap.height]; bitmap.close()
        const picture = view.picture
        view.picture = async () => { throw Error('Sample storage unavailable') }
        await view.saving(() => view.saveOver(original, true))
        view.picture = picture
        if (view.editor.status?.kind !== 'error') throw Error('Missing save error')
        await screenshot('failed')
        view.editor.status = { kind: 'saving', text: 'Saving 48 MP…' }; await screenshot('saving')
        view.editor.status = null
        click('Pen'); await screenshot('draw')
        if (!${phone}) await narrowShot('narrow-draw')
        view.session.zoomBy(2); await screenshot('zoomed')
        view.contentEl.querySelector('.abele-picture-editor__save').click(); await screenshot('save-menu')
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        view.editor.dirty = true
        const cancelling = view.cancel()
        await until(() => [...document.querySelectorAll('.modal-title')].some(el => el.textContent.includes('Discard picture edits')))
        await screenshot('cancel-ask')
        const keep = [...document.querySelectorAll('.modal-container button')].find(el => el.textContent.trim() === 'Cancel')
        if (!keep) throw Error('Missing cancel confirmation button')
        keep.click(); await cancelling
        const saved = await createImageBitmap(new Blob([await app.vault.readBinary(original)]))
        const originalSize = [saved.width, saved.height]; saved.close()
        view.leaf.detach()
        const heicFile = await app.vault.createBinary(dir + '/sample-${phone ? 'phone' : 'desktop'}.heic', Uint8Array.from(atob(${JSON.stringify(heic)}), c => c.charCodeAt(0)).buffer)
        await window.__abeleTest.openImageInk(app, heicFile.path, '', null, '', true)
        const heicView = await until(() => app.workspace.getLeavesOfType('abele-image-ink').map(l => l.view).find(v => v.editor.width || v.editor.status?.kind === 'error'))
        await screenshot('heic')
        if (await heicView.saveOver(heicFile, true)) throw Error('HEIC overwrite was allowed')
        if (heicView.editor.width) {
          const copy = await heicView.saveNew(heicFile)
          if (copy.extension !== 'jpg') throw Error('HEIC copy was not JPEG')
        }
        if (heicView.editor.width) {
          heicView.contentEl.querySelector('.abele-picture-editor__save').click(); await screenshot('heic-save-menu')
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        }
        heicView.leaf.detach()
        if (${phone}) {
          canvas.width = 2000; canvas.height = 160
          ctx.fillStyle = '#3978bd'; ctx.fillRect(0, 0, 2000, 160)
          ctx.fillStyle = '#f1c344'; ctx.fillRect(0, 0, 1000, 160)
          const thinBlob = await new Promise(r => canvas.toBlob(r))
          const sourceBytes = await thinBlob.arrayBuffer()
          const thinFile = await app.vault.createBinary(dir + '/sample-thin.png', sourceBytes)
          await window.__abeleTest.openImageInk(app, thinFile.path, '', null, '', true)
          const thinView = await until(() => app.workspace.getLeavesOfType('abele-image-ink').map(l => l.view).find(v => v.editor.width === 2000))
          await until(() => thinView.session.surface.width > 0 && thinView.model.zoom < 1 && thinView.contentEl.querySelector('.abele-crop-frame'))
          const fitZoom = thinView.model.zoom
          const frameBefore = JSON.stringify(thinView.editor.crop.rect)
          const pinchAcrossBoundary = async (scale) => {
            const frame = thinView.contentEl.querySelector('.abele-crop-frame').getBoundingClientRect()
            const stageEl = thinView.contentEl.querySelector('.abele-picture-editor__stage')
            const stage = stageEl.getBoundingClientRect()
            const a = { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2, id: 0 }
            const b = { x: stage.x + stage.width / 2, y: (frame.bottom + stage.bottom) / 2, id: 1 }
            if (![a, b].every(p => stageEl.contains(document.elementFromPoint(p.x, p.y)))) throw Error('Pinch contact is obscured outside the editor stage')
            if (document.elementFromPoint(b.x, b.y)?.closest('.abele-crop-frame')) throw Error('Pinch did not start across the background boundary')
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
            await wc.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] })
            await wc.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [a, b].map(p => ({ x: mx + (p.x - mx) * scale, y: my + (p.y - my) * scale, id: p.id })) })
            await wc.debugger.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
            await wait(100)
          }
          await pinchAcrossBoundary(1.5)
          const enlarged = thinView.model.zoom
          if (enlarged <= fitZoom) throw Error('Thin picture did not zoom in')
          await pinchAcrossBoundary(0.7)
          if (thinView.model.zoom >= enlarged) throw Error('Thin picture ignored pinch out')
          await pinchAcrossBoundary(0.7)
          if (thinView.model.zoom > fitZoom) throw Error('Pinch out could not return to fit-to-view')
          if (JSON.stringify(thinView.editor.crop.rect) !== frameBefore) throw Error('Pinch resized the thin picture crop')
          await screenshot('pinch-out')
          thinView.editor.crop.rect = { x: 0.5, y: 0, w: 0.5, h: 1 }
          const cropped = await thinView.saveNew(thinFile)
          const copyBytes = await app.vault.readBinary(cropped)
          const pixels = await createImageBitmap(new Blob([copyBytes]))
          if (pixels.width !== 1000 || pixels.height !== 160) throw Error('Saved copy did not apply the crop')
          const sample = document.createElement('canvas'); sample.width = sample.height = 1
          const sampleCtx = sample.getContext('2d'); sampleCtx.drawImage(pixels, 0, 0)
          pixels.close()
          if (JSON.stringify([...sampleCtx.getImageData(0, 0, 1, 1).data]) !== '[57,120,189,255]') throw Error('Saved copy has the wrong crop pixels')
          const after = new Uint8Array(await app.vault.readBinary(thinFile))
          if (after.length !== sourceBytes.byteLength || !after.every((v, i) => v === new Uint8Array(sourceBytes)[i])) throw Error('Saving the crop changed the original')
          thinView.leaf.detach()
        }
        if (!${phone}) {
          canvas.width = 8000; canvas.height = 6000
          ctx.fillStyle = '#3978bd'; ctx.fillRect(0, 0, 8000, 6000)
          const largeBlob = await new Promise(r => canvas.toBlob(r))
          const largeFile = await app.vault.createBinary(dir + '/sample-large.png', await largeBlob.arrayBuffer())
          await window.__abeleTest.openImageInk(app, largeFile.path, '', null, '', true)
          const largeView = await until(() => app.workspace.getLeavesOfType('abele-image-ink').map(l => l.view).find(v => v.editor.width === 8000))
          await until(() => largeView.session.surface.width > 0)
          let ticks = 0
          let lastTick = performance.now(), longestPause = 0
          const timer = setInterval(() => { const now = performance.now(); longestPause = Math.max(longestPause, now - lastTick); lastTick = now; ticks++ }, 16)
          let release
          const gate = new Promise(r => { release = r })
          const saving = largeView.saving(async () => {
            const copy = await largeView.saveNew(largeFile)
            if (!copy) throw Error('Large picture was not saved')
            const pixels = await createImageBitmap(new Blob([await app.vault.readBinary(copy)]))
            const complete = pixels.width === 8000 && pixels.height === 6000
            pixels.close()
            if (!complete) throw Error('Large picture lost full resolution')
            await gate
            return copy
          })
          try {
            await until(() => largeView.editor.status?.kind === 'saving')
            await screenshot('large-saving')
            if (ticks < 2) throw Error('Large picture save blocked the event loop')
            if (longestPause > 1000) throw Error('Large picture save stalled for ' + Math.round(longestPause) + ' ms')
          } finally {
            release(); clearInterval(timer); await saving; largeView.leaf.detach()
          }
          if (largeView.editor.status?.kind === 'error') throw Error(largeView.editor.status.text)
        }
        return { size, original: originalSize }
      } catch (error) { return { error: String(error.stack || error) } }
    })()`,
        120000
      )
      expect(result.error).toBeUndefined()
      expect(result.size).toEqual([300, 400])
      expect(result.original).toEqual([800, 600])
    }, 150000)
})
