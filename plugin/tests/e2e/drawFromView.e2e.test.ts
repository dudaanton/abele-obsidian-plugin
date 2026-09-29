/**
 * Drawing on a picture begun where the picture is looked at, in the running app: the pen in the
 * header of Obsidian's own picture tab and the item in that tab's menu; "Draw on this picture" in
 * the menu of a picture shown in a note, in reading view and in live preview; the pen under the
 * gallery's full-screen picture. Each opens the drawing tab with that picture.
 *
 * Opened from a note, the drawing can be saved as a new picture that takes the original's place
 * in that one embed, written as it was; the note changed so that the embed cannot be told apart,
 * the picture is saved and the note left alone.
 *
 * Then on a phone at 390×844 under `emulateMobile`: the pen is in the picture tab's header, inside
 * the screen. Pictures go to `/tmp/abele-phone/draw-from-view-*.png` — look at them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  useDomMenus,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Draw from view e2e'
const PIC = `${DIR}/pic.png`
const NOTE = `${DIR}/Note.md`
const GALLERY = `${DIR}/Gallery.md`
const SHOTS = shotDir('abele-phone')
const WIKI = `![[${PIC}|200]]`
const MARKDOWN = `![alt|120](${DIR.replace(/ /g, '%20')}/pic.png)`
const NOTE_TEXT = `# Note\n\n${WIKI}\n\nBetween.\n\n${MARKDOWN}\n`

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

const PRELUDE = `
  const DIR = ${JSON.stringify(DIR)}
  const PIC = ${JSON.stringify(PIC)}
  const NOTE = ${JSON.stringify(NOTE)}
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const inks = () => app.workspace.getLeavesOfType('abele-image-ink')
  const closeInks = () => inks().forEach((l) => l.detach())
  /** The drawing tab once it shows its picture: the picture's path and the embed it came from. */
  const opened = async () => {
    const leaf = await until(() => inks().find((l) => l.view.session?.backdrop), 8000)
    return leaf ? { path: leaf.view.getState().path, embed: leaf.view.getState().embed, view: leaf.view } : null
  }
  /** Picks an item of the Obsidian menu open now by its title; false when there is none. */
  const pickMenu = async (title) => {
    const item = await until(() => [...document.querySelectorAll('.menu .menu-item')].find((el) => el.querySelector('.menu-item-title')?.textContent.trim() === title), 3000)
    if (!item) { document.querySelector('.menu')?.remove(); return false }
    item.click()
    await wait(200)
    return true
  }
  const rightClick = (el) => {
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 5, clientY: r.top + 5, button: 2 }))
  }
  const openNote = async (mode) => {
    const leaf = app.workspace.getLeaf(false)
    await leaf.setViewState({ type: 'markdown', state: { file: NOTE, mode, source: false }, active: true })
    await wait(300)
    return leaf
  }
  const pictures = (leaf, mode) =>
    [...leaf.view.containerEl.querySelectorAll(mode === 'preview' ? '.markdown-preview-view .image-embed img' : '.markdown-source-view .image-embed img')]
  const read = () => app.vault.read(app.vault.getAbstractFileByPath(NOTE))
  const shoot = async (name) => {
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/draw-from-view-' + name + '.png', img.toPNG()) }
  }
  const drawn = () => app.vault.getFiles().filter((f) => f.path.startsWith(DIR + '/pic drawn')).map((f) => f.path).sort()
  const dropDrawn = async () => { for (const p of drawn()) await app.vault.delete(app.vault.getAbstractFileByPath(p)) }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

describe.skipIf(!available)('drawing on a picture from where it is looked at', () => {
  let size: [number, number] = [0, 0]

  beforeAll(() => {
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    useDomMenus()
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        const c = document.createElement('canvas'); c.width = 300; c.height = 200
        const g = c.getContext('2d'); g.fillStyle = '#cccccc'; g.fillRect(0, 0, 300, 200)
        const bytes = await new Promise((ok) => c.toBlob((b) => b.arrayBuffer().then(ok), 'image/png'))
        await app.vault.createBinary(${JSON.stringify(PIC)}, bytes)
        await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(NOTE_TEXT)})
        await app.vault.create(${JSON.stringify(GALLERY)}, ${JSON.stringify(`# Gallery\n\n::abele-gallery::\n![[${PIC}]]\n\nAfter.\n`)})
        return 'ok'
      })()`,
      60_000
    )
  }, 90_000)

  afterAll(async () => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-image-ink')) leaf.detach()
        for (const leaf of app.workspace.getLeavesOfType('image')) if (leaf.view.file?.path.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        for (const leaf of app.workspace.getLeavesOfType('markdown')) if (leaf.view.file?.path.startsWith(${JSON.stringify(DIR)})) leaf.detach()
        document.querySelector('.abele-gallery-viewer')?.click()
        await new Promise((r) => setTimeout(r, 1500))
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
    if (evalJson<boolean>('app.isMobile')) {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reloadApp('app.emulateMobile(false)')
    }
  }, 180_000)

  it('has a pen in the picture tab’s header and the item in its menu, both opening the drawing tab', () => {
    const r = run<{
      error?: string
      pens?: number
      fromPen?: { path: string } | null
      fromMenu?: { path: string } | null
    }>(`
      closeInks()
      // No tab group once the last tab went: the tab is then made in the main area directly.
      let leaf
      try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
      await leaf.openFile(app.vault.getAbstractFileByPath(PIC))
      const pen = await until(() => leaf.view.containerEl.querySelector('.view-actions .abele-draw-on-picture'))
      const pens = leaf.view.containerEl.querySelectorAll('.abele-draw-on-picture').length
      pen.click()
      const a = await opened()
      const fromPen = a && { path: a.path }
      closeInks()
      app.workspace.setActiveLeaf(leaf)
      leaf.view.containerEl.querySelector('.view-action[aria-label="More options"]').click()
      await pickMenu('Draw on this picture')
      const b = await opened()
      const fromMenu = b && { path: b.path }
      closeInks()
      leaf.detach()
      return { pens, fromPen, fromMenu }
    `)
    expect(r.error).toBeUndefined()
    expect(r.pens).toBe(1)
    expect(r.fromPen).toEqual({ path: PIC })
    expect(r.fromMenu).toEqual({ path: PIC })
  })

  it('opens from a picture’s menu in reading view, and puts the new picture in that embed’s place', () => {
    const r = run<{
      error?: string
      embed?: unknown
      changed?: { replaced: boolean; text: string; files: string[] }
      replaced?: boolean
      text?: string
      files?: string[]
      again?: string
    }>(`
      closeInks(); await dropDrawn()
      await app.vault.modify(app.vault.getAbstractFileByPath(NOTE), ${JSON.stringify(NOTE_TEXT)})
      const leaf = await openNote('preview')
      const imgs = await until(() => { const i = pictures(leaf, 'preview'); return i.length === 2 && i.every((x) => x.complete) && i })
      rightClick(imgs[1])
      await pickMenu('Draw on this picture')
      const o = await opened()
      if (!o) return { error: 'no drawing tab' }
      const view = o.view
      // The note changed so that the embed is written twice elsewhere: nothing is guessed.
      const moved = 'Added.\\n' + ${JSON.stringify(NOTE_TEXT)} + '\\n' + ${JSON.stringify(MARKDOWN)} + '\\n'
      await app.vault.modify(app.vault.getAbstractFileByPath(NOTE), moved)
      const ok1 = await view.saveInNote(app.vault.getAbstractFileByPath(PIC))
      const changed = { replaced: ok1, text: (await read()) === moved ? 'unchanged' : 'changed', files: drawn() }
      await dropDrawn()
      await app.vault.modify(app.vault.getAbstractFileByPath(NOTE), ${JSON.stringify(NOTE_TEXT)})
      // Chosen from the bar's menu.
      view.moreMenu(new MouseEvent('click', { clientX: 200, clientY: 200 }))
      await pickMenu('Save as a new picture and replace it in the note')
      await until(async () => (await read()) !== ${JSON.stringify(NOTE_TEXT)}, 5000)
      const text = await read()
      const files = drawn()
      // Saved again: the embed now showing the first new picture is the one replaced.
      await view.saveInNote(app.vault.getAbstractFileByPath(PIC))
      const again = await read()
      closeInks()
      leaf.detach()
      return { embed: o.embed, changed, text, files, again }
    `)
    expect(r.error).toBeUndefined()
    expect(r.embed).toEqual({ note: NOTE, start: NOTE_TEXT.indexOf(MARKDOWN), original: MARKDOWN })
    expect(r.changed).toEqual({
      replaced: false,
      text: 'unchanged',
      files: [`${DIR}/pic drawn.png`],
    })
    expect(r.files).toEqual([`${DIR}/pic drawn.png`])
    // The Markdown link stays one, with its caption and size; the wikilink above is untouched.
    expect(r.text).toContain(WIKI)
    expect(r.text).not.toContain(MARKDOWN)
    expect(r.text).toMatch(/!\[alt\|120\]\([^)]*pic%20drawn\.png\)/)
    expect(r.again).toMatch(/!\[alt\|120\]\([^)]*pic%20drawn%202\.png\)/)
  })

  it('opens from a picture’s link menu in live preview, knowing which embed, and replaces a wikilink as one', () => {
    const r = run<{ error?: string; embed?: unknown; text?: string; pic?: boolean }>(`
      closeInks(); await dropDrawn()
      await app.vault.modify(app.vault.getAbstractFileByPath(NOTE), ${JSON.stringify(NOTE_TEXT)})
      const leaf = await openNote('source')
      const imgs = await until(() => { const i = pictures(leaf, 'source'); return i.length === 2 && i })
      rightClick(imgs[0])
      await pickMenu('Draw on this picture')
      const o = await opened()
      if (!o) return { error: 'no drawing tab' }
      await o.view.saveInNote(app.vault.getAbstractFileByPath(PIC))
      const text = await read()
      closeInks()
      leaf.detach()
      return { embed: o.embed, text, pic: !!app.vault.getAbstractFileByPath(PIC) }
    `)
    expect(r.error).toBeUndefined()
    expect(r.embed).toEqual({ note: NOTE, start: NOTE_TEXT.indexOf(WIKI), original: WIKI })
    expect(r.text).toMatch(/!\[\[[^\]|]*pic drawn\.png\|200\]\]/)
    expect(r.text).toContain(MARKDOWN)
    // The original picture stays.
    expect(r.pic).toBe(true)
  })

  it('has a pen under the gallery’s full-screen picture that opens it for drawing', () => {
    const r = run<{ error?: string; label?: string; closed?: boolean; path?: string }>(`
      closeInks()
      const leaf = app.workspace.getLeaf(false)
      await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(GALLERY)}, mode: 'preview' }, active: true })
      const thumb = await until(() => leaf.view.containerEl.querySelector('.markdown-preview-view .abele-gallery__image'), 10000)
      if (!thumb) return { error: 'no gallery' }
      thumb.click()
      const pen = await until(() => [...document.querySelectorAll('.abele-gallery-viewer__toolbar .abele-obsidian-icon')].find((el) => el.textContent.trim() === 'Draw'))
      if (!pen) return { error: 'no pen in the viewer' }
      const label = pen.getAttribute('aria-label')
      pen.click()
      const o = await opened()
      const closed = !document.querySelector('.abele-gallery-viewer')
      closeInks()
      leaf.detach()
      return { label, closed, path: o?.path }
    `)
    expect(r.error).toBeUndefined()
    expect(r.label).toBe('Draw on this picture')
    expect(r.closed).toBe(true)
    expect(r.path).toBe(PIC)
  })

  it('has the pen in the picture tab’s header on a phone, inside the screen', async () => {
    await reloadApp('app.emulateMobile(true)')
    await setWindowSize(390, 844)
    await reloadApp('location.reload()')
    const r = run<{
      error?: string
      pen?: { left: number; right: number; top: number; bottom: number; shown: boolean }
      width?: number
      path?: string
      bar?: { left: number; right: number; height: number }
      pressed?: unknown
    }>(`
      await until(() => app.workspace.layoutReady, 15000)
      closeInks()
      // No tab group once the last tab went: the tab is then made in the main area directly.
      let leaf
      try { leaf = app.workspace.getLeaf('tab') } catch { leaf = app.workspace.createLeafInParent(app.workspace.rootSplit, 0) }
      await leaf.openFile(app.vault.getAbstractFileByPath(PIC))
      const pen = await until(() => leaf.view.containerEl.querySelector('.abele-draw-on-picture'))
      if (!pen) return { error: 'no pen' }
      await wait(400)
      await shoot('picture-tab')
      const b = pen.getBoundingClientRect()
      const shown = getComputedStyle(pen).display !== 'none' && b.width > 0
      pen.click()
      const o = await opened()
      await wait(300)
      await shoot('drawing')
      closeInks()
      // The gallery's viewer: its bar, the pen in it, inside the screen.
      await leaf.setViewState({ type: 'markdown', state: { file: ${JSON.stringify(GALLERY)}, mode: 'preview' }, active: true })
      const thumb = await until(() => leaf.view.containerEl.querySelector('.markdown-preview-view .abele-gallery__image'), 10000)
      thumb?.click()
      const bar = await until(() => document.querySelector('.abele-gallery-viewer__toolbar'))
      await wait(400)
      await shoot('gallery-viewer')
      const bb = bar?.getBoundingClientRect()
      document.querySelector('.abele-gallery-viewer')?.click()
      // A long press on a picture being edited: the phone gives it no menu, the plugin does.
      await app.vault.modify(app.vault.getAbstractFileByPath(NOTE), ${JSON.stringify(NOTE_TEXT)})
      await leaf.setViewState({ type: 'markdown', state: { file: NOTE, mode: 'source', source: false }, active: true })
      const imgs = await until(() => { const i = pictures(leaf, 'source'); return i.length === 2 && i }, 10000)
      let pressed = null
      if (imgs) {
        const cdp = require('@electron/remote').getCurrentWebContents().debugger
        try { cdp.attach('1.3') } catch {}
        const p = imgs[0].getBoundingClientRect()
        const at = [{ x: Math.round(p.left + 20), y: Math.round(p.top + 20), id: 0 }]
        await cdp.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at })
        await wait(1300)
        await cdp.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
        await wait(300)
        await shoot('long-press')
        if (await pickMenu('Draw on this picture')) pressed = (await opened())?.embed ?? 'no tab'
        closeInks()
      }
      leaf.detach()
      return { pressed, pen: { left: b.left, right: b.right, top: b.top, bottom: b.bottom, shown }, width: innerWidth, path: o?.path, bar: bb && { left: bb.left, right: bb.right, height: bb.height } }
    `)
    expect(r.error).toBeUndefined()
    expect(r.pen!.shown).toBe(true)
    expect(r.pen!.left).toBeGreaterThanOrEqual(0)
    expect(r.pen!.right).toBeLessThanOrEqual(r.width!)
    expect(r.path).toBe(PIC)
    // One row, inside the screen.
    expect(r.bar!.left).toBeGreaterThanOrEqual(0)
    expect(r.bar!.right).toBeLessThanOrEqual(r.width!)
    expect(r.bar!.height).toBeLessThan(60)
    expect(r.pressed).toEqual({ note: NOTE, start: NOTE_TEXT.indexOf(WIKI), original: WIKI })
  })
})
