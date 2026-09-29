/**
 * Menus opened inside the picture viewer — the full-screen view a gallery picture opens in —
 * must show above it. The viewer covers the whole window, so a menu drawn under it is simply not
 * there for the person: they right-click, or tap "More", and nothing seems to happen.
 *
 * Both roads are asked the same question: at the centre of the menu, which element is on top?
 * A menu under the viewer answers with the viewer's backdrop or its picture.
 *
 * The note and picture live in `Gallery viewer e2e/` for the length of this file and are deleted
 * after it, so the fixture vault ends with nothing but `ScaleTest/` in it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
  useDomMenus,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Gallery viewer e2e'
const NOTE = `${DIR}/sample-gallery.md`
const PICTURE = `${DIR}/sample-picture.png`
const PHONE = { width: 390, height: 844 }

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 15000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) {
      try { const v = fn(); if (v) return v } catch {}
      await wait(100)
    }
    return null
  }
  const closeMenus = () => document.querySelectorAll('.menu').forEach((m) => m.remove())
  const closeViewer = async () => {
    const v = document.querySelector('.abele-gallery-viewer')
    if (!v) return
    v.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await until(() => !document.querySelector('.abele-gallery-viewer'), 3000)
  }
  /** The menu that is open, and what is on top at its centre. */
  const menuOnTop = () => {
    const menu = document.querySelector('.menu')
    if (!menu) return { menu: false }
    const r = menu.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 20))
    return {
      menu: true,
      onTop: !!hit && menu.contains(hit),
      hit: hit ? (hit.className || hit.tagName).toString() : null,
    }
  }
  /** Opens the note in reading view and the viewer on its one picture. */
  const openViewer = async () => {
    closeMenus()
    await closeViewer()
    const file = app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)})
    const leaf = app.workspace.getLeaf(false)
    await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'preview' }, active: true })
    app.workspace.revealLeaf(leaf)
    // The pictures load lazily: one off screen never would, so it is scrolled to first.
    const img = await until(() => leaf.view.containerEl.querySelector('.abele-gallery img.abele-gallery__image'))
    if (!img) return { error: 'no gallery picture' }
    img.scrollIntoView({ block: 'center' })
    if (!(await until(() => img.complete && img.naturalWidth > 0))) return { error: 'the gallery picture did not load' }
    img.click()
    const viewer = await until(() => document.querySelector('.abele-gallery-viewer img.abele-gallery-viewer__image'))
    if (!viewer) return { error: 'the viewer did not open' }
    await until(() => viewer.complete && viewer.naturalWidth > 0, 5000)
    return { viewer }
  }
`

type Hit = { error?: string; menu: boolean; onTop?: boolean; hit?: string | null }

/** Opens the viewer and its "More" menu from the toolbar. */
const moreMenu = (): Hit =>
  evalAsync<Hit>(
    `(async () => {
    ${PRELUDE}
    const opened = await openViewer()
    if (opened.error) return { error: opened.error, menu: false }
    const more = Array.from(document.querySelectorAll('.abele-gallery-viewer__toolbar .abele-obsidian-icon'))
      .find((el) => el.textContent.includes('More'))
    if (!more) return { error: 'no More button', menu: false }
    more.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }))
    await until(() => document.querySelector('.menu'), 3000)
    await wait(300)
    const seen = menuOnTop()
    closeMenus()
    await closeViewer()
    return seen
  })()`,
    60_000
  )

/** The centre of the viewer's picture, after opening the viewer. */
const openViewerAt = (): { error?: string; x: number; y: number } =>
  evalAsync(
    `(async () => {
    ${PRELUDE}
    const opened = await openViewer()
    if (opened.error) return { error: opened.error, x: 0, y: 0 }
    const r = opened.viewer.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })()`,
    60_000
  )

const cdp = (method: string, params: object): void => {
  runCli(['dev:cdp', `method=${method}`, `params=${JSON.stringify(params)}`], 30_000)
}

/** A right click the way a mouse makes one, through the page's input pipeline. */
const rightClick = (x: number, y: number): void => {
  cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' })
  cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1 })
  cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1 })
}

const afterRightClick = (): Hit =>
  evalAsync<Hit>(
    `(async () => {
    ${PRELUDE}
    await until(() => document.querySelector('.menu'), 3000)
    await wait(300)
    const seen = menuOnTop()
    closeMenus()
    await closeViewer()
    return seen
  })()`,
    30_000
  )

const rightClickMenu = (): Hit => {
  const at = openViewerAt()
  if (at.error) return { error: at.error, menu: false }
  rightClick(at.x, at.y)
  return afterRightClick()
}

const expectOnTop = (r: Hit) => {
  expect(r.error).toBeUndefined()
  expect(r.menu).toBe(true)
  expect(r.hit === null ? 'nothing' : r.onTop ? 'the menu' : r.hit).toBe('the menu')
}

const windowSize = (): [number, number] =>
  evalJson<[number, number]>(`require('@electron/remote').getCurrentWindow().getContentSize()`)

const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

describe.skipIf(!available)('menus in the picture viewer', () => {
  beforeAll(() => {
    useDomMenus()
    evalAsync(`(async () => {
      const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (old) await app.vault.delete(old, true)
      await app.vault.createFolder(${JSON.stringify(DIR)})
      const c = document.createElement('canvas'); c.width = 320; c.height = 200
      const x = c.getContext('2d'); x.fillStyle = '#2a7ab0'; x.fillRect(0, 0, 320, 200)
      const bytes = Uint8Array.from(atob(c.toDataURL('image/png').split(',')[1]), (ch) => ch.charCodeAt(0))
      await app.vault.createBinary(${JSON.stringify(PICTURE)}, bytes.buffer)
      await app.vault.create(${JSON.stringify(NOTE)},
        '# Sample\\n\\n::abele-gallery::\\n![[${PICTURE}]]\\n\\nAfter.\\n')
      return { ok: true }
    })()`)
  })

  afterAll(() => {
    evalAsync(`(async () => {
      document.querySelectorAll('.menu').forEach((m) => m.remove())
      document.querySelector('.abele-gallery-viewer')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      for (const l of app.workspace.getLeavesOfType('markdown'))
        if (l.view.file?.path.startsWith(${JSON.stringify(DIR + '/')})) l.detach()
      const f = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
      if (f) await app.vault.delete(f, true)
      return { ok: true }
    })()`)
  })

  it('keeps the viewer under the layers Obsidian opens over a dialog: menus and notices', () => {
    // The stacking alone, with Obsidian's own styles for a menu and a notice, and the plugin's
    // for the viewer: no drawing needed, so it holds even where the note never renders.
    const r = evalJson<Record<string, string>>(`(() => {
      const viewer = document.body.createDiv({ cls: 'abele-gallery-viewer' })
      const at = (el) => {
        const b = el.getBoundingClientRect()
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(b.height / 2, 10))
        return hit && el.contains(hit) ? 'on top' : (hit ? String(hit.className) : 'nothing')
      }
      const menu = document.body.createDiv({ cls: 'menu' })
      menu.createDiv({ cls: 'menu-item', text: 'Sample item' })
      Object.assign(menu.style, { left: '100px', top: '100px' })
      const notices = document.body.createDiv({ cls: 'notice-container' })
      const notice = notices.createDiv({ cls: 'notice', text: 'Sample notice' })
      const out = { menu: at(menu), notice: at(notice) }
      menu.remove(); notices.remove(); viewer.remove()
      return out
    })()`)
    expect(r).toEqual({ menu: 'on top', notice: 'on top' })
  })

  it('shows the "More" menu above the viewer', () => {
    expectOnTop(moreMenu())
  })

  it('shows the menu of a right click on the picture above the viewer', () => {
    expectOnTop(rightClickMenu())
  })

  describe('on a phone', () => {
    let size: [number, number] = [0, 0]

    beforeAll(async () => {
      size = windowSize()
      await reloadApp('app.emulateMobile(true)')
      await setWindowSize(PHONE.width, PHONE.height)
      await reloadApp('window.location.reload()')
      // A hidden window hands back no frame after a reload until its size is nudged.
      await setWindowSize(PHONE.width + 2, PHONE.height + 2)
      await setWindowSize(PHONE.width, PHONE.height)
    }, 300_000)

    afterAll(async () => {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reloadApp('app.emulateMobile(false)')
    }, 180_000)

    it('shows the "More" menu above the viewer', () => {
      expectOnTop(moreMenu())
    })
  })
})
