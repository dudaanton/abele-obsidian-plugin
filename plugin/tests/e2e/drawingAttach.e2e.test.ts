/**
 * A drawing attached to the chat in front, in the running app: the paperclip in the drawing tab's
 * header makes a PNG of what is drawn — real PNG bytes, the stroke in its pixels — saved with the
 * vault's attachments and put into the chat's input as an attachment. Nothing is sent.
 *
 * A picture goes to `/tmp/abele-phone/drawing-attach.png` — look at it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { evalJson, evalRaw, hasTestApi, isObsidianRunning, runCli } from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const aiOn = (): boolean =>
  evalJson<boolean>('!!window.__abeleTest?.AbeleConfig.getInstance().ai.enabled')
const DIR = 'Abele drawing attach e2e'
const SHOTS = '/tmp/abele-phone'

const PRELUDE = `
  const DIR = ${JSON.stringify(DIR)}
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const wc = require('@electron/remote').getCurrentWebContents()
  const input = (type, x, y, buttons) =>
    wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), button: 'left', buttons, clickCount: 1, pointerType: 'pen', force: 0.5 })
  const stroke = async (pts) => {
    await input('mousePressed', pts[0][0], pts[0][1], 1)
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i]
      for (let j = 1; j <= 6; j++) { await input('mouseMoved', ax + (bx - ax) * j / 6, ay + (by - ay) * j / 6, 1); await wait(6) }
    }
    const [lx, ly] = pts[pts.length - 1]
    await input('mouseReleased', lx, ly, 0)
    await wait(150)
  }
  const views = () => app.workspace.getLeavesOfType('abele-drawing').map((l) => l.view)
  const read = async (path) => { const f = app.vault.getAbstractFileByPath(path); return f ? app.vault.read(f) : null }
  const chips = () => [...document.querySelectorAll('.abele-chat-input__attachment')]
  const shoot = async (name) => {
    const img = await Promise.race([wc.capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/drawing-' + name + '.png', img.toPNG()) }
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

describe.skipIf(!available)('a drawing attached to the chat', () => {
  let rightWasCollapsed = true

  beforeAll(() => {
    runCli(['dev:debug', 'on'], 30_000)
    rightWasCollapsed = evalJson<boolean>('app.workspace.rightSplit.collapsed')
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(() => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-drawing')) leaf.detach()
        for (const chip of [...document.querySelectorAll('.abele-chat-input__attachment')])
          if (chip.textContent.includes('Drawing')) chip.querySelector('.abele-chat-input__attachment-remove')?.click()
        await new Promise((r) => setTimeout(r, 2500))
        for (const f of app.vault.getFiles()) if (f.path.startsWith(window.__attachedDrawingPng ?? '\\u0000')) await app.vault.delete(f)
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        if (${rightWasCollapsed}) app.workspace.rightSplit.collapse()
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  it('goes from the paperclip in the tab’s header as a PNG attached to what is written there', () => {
    if (!aiOn()) return
    const r = run<{
      error?: string
      action?: boolean
      chip?: string
      path?: string
      signature?: number[]
      size?: { w: number; h: number; dark: number }
      sent?: number
    }>(`
      for (const leaf of app.workspace.getLeavesOfType('abele-drawing')) leaf.detach()
      await window.__abeleTest.newDrawing(app, app.vault.getAbstractFileByPath(DIR))
      const view = await until(() => views().find((v) => v.session && v.file && v.model.on && v.session.surface.width > 0), 10000)
      await wait(300)
      const b = view.session.surface.el.getBoundingClientRect()
      await stroke([[b.left + 80, b.top + 80], [b.left + 260, b.top + 200], [b.left + 80, b.top + 260]])
      view.contentEl.querySelector('.abele-drawing-bar__mode').click()
      await until(async () => (await read(view.file.path)).includes('<path d="M'), 5000)
      const session = window.__abeleTest.ChatService?.getInstance?.().activeSession?.value
      const messagesBefore = session?.messages?.value?.length ?? 0
      const action = view.containerEl.querySelector('.view-actions [aria-label="Attach to the chat as a picture"]')
      action?.click()
      const name = view.file.basename + '.png'
      const chip = await until(() => chips().map((c) => c.textContent.trim()).find((t) => t.includes(name)), 8000)
      const png = await until(() => app.vault.getFiles().find((f) => f.name === name && f.extension === 'png'), 5000)
      window.__attachedDrawingPng = png?.path
      const bytes = png ? new Uint8Array(await app.vault.readBinary(png)) : new Uint8Array()
      let size = null
      if (png) {
        const img = new Image(); img.src = app.vault.getResourcePath(png); await img.decode()
        const k = document.createElement('canvas'); k.width = img.naturalWidth; k.height = img.naturalHeight
        const x = k.getContext('2d'); x.drawImage(img, 0, 0)
        const px = x.getImageData(0, 0, k.width, k.height).data
        let dark = 0
        for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 300) dark++
        size = { w: img.naturalWidth, h: img.naturalHeight, dark }
      }
      await shoot('attach')
      const after = window.__abeleTest.ChatService?.getInstance?.().activeSession?.value
      return { action: !!action, chip, path: png?.path, signature: [...bytes.slice(0, 8)], size, sent: (after?.messages?.value?.length ?? 0) - messagesBefore }
    `)
    expect(r.error).toBeUndefined()
    expect(r.action).toBe(true)
    expect(r.chip).toBeTruthy()
    expect(r.path).toMatch(/\.png$/)
    expect(r.signature).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(r.size!.w).toBeGreaterThan(50)
    expect(r.size!.h).toBeGreaterThan(50)
    // The stroke is in the picture, not a blank sheet.
    expect(r.size!.dark).toBeGreaterThan(100)
    // Only attached: nothing was sent.
    expect(r.sent).toBe(0)
  })
})
