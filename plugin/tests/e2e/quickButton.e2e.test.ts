/**
 * The quick button on a phone (390×844 under `emulateMobile`), in a note, in a book and over the
 * chat: it stands inside the screen, above whatever is at the bottom — Obsidian's navigation
 * bar, the line under a book's page, the chat's message box — and overlaps none of it; a tap
 * opens the menu with what that screen offers; a scroll down or a page turned forward tucks it to
 * the edge, and a field with focus takes it away.
 *
 * Pictures of each go to `/tmp/abele-phone/fab-*.png` — look at them. A real finger, iOS's own
 * keyboard and the real safe areas are for the phone itself.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  evalJson,
  evalRaw,
  hasTestApi,
  isObsidianRunning,
  reloadApp,
  runCli,
} from './helpers/obsidianCli'
import { evalAsync } from './helpers/githubLive'
import { buildRichEpub } from '../fixtures/books/richBook'

const available = isObsidianRunning() && hasTestApi()
const DIR = 'Abele quick button e2e'
const NOTE = `${DIR}/Long note.md`
const BOOK = `${DIR}/rich.epub`
const SHOTS = '/tmp/abele-phone'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const setWindowSize = async (width: number, height: number): Promise<void> => {
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}
const attachDebugger = (): void => void runCli(['dev:debug', 'on'], 30_000)

const reload = async (how: string): Promise<void> => {
  await reloadApp(how)
  attachDebugger()
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWebContents().setBackgroundThrottling(false); return 'ok' })()`
  )
}

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms = 8000) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { try { const v = await fn(); if (v) return v } catch {} await wait(50) }
    return null
  }
  const cdp = require('@electron/remote').getCurrentWebContents().debugger
  const touch = (type, points = []) => cdp.sendCommand('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id })),
  })
  const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await wait(60); await touch('touchEnd'); await wait(900) }
  const shoot = async (name) => {
    const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
    if (img) { require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true }); require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/fab-' + name + '.png', img.toPNG()) }
  }
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
  const fab = () => document.querySelector('.abele-floating-button')
  /** Waits out the button's slide, then says where it stands and what is under it. */
  const report = async (below) => {
    await wait(500)
    const b = fab()
    const under = [...document.querySelectorAll(below)].filter((e) => e.getClientRects().length).map(box)
    // Where it stands, without the slide to the edge: offsets ignore a transform.
    const slot = b && { left: b.offsetLeft, right: b.offsetLeft + b.offsetWidth, top: b.offsetTop, bottom: b.offsetTop + b.offsetHeight }
    return {
      button: box(b), slot, tucked: !!b && b.classList.contains('abele-floating-button_tucked'),
      under, screen: { width: innerWidth, height: innerHeight },
    }
  }
  /** The middle of what is on screen of it: tucked, only a sliver is. */
  const tapFab = async () => {
    const r = fab().getBoundingClientRect()
    await tap((Math.max(r.left, 0) + Math.min(r.right, innerWidth)) / 2, r.top + r.height / 2)
  }
  const menuTitles = () => [...document.querySelectorAll('.menu .menu-item-title')].map((e) => e.textContent)
  const closeMenu = async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await wait(400)
    document.querySelector('.menu')?.remove()
    await wait(200)
  }
`

const run = <T>(body: string): T =>
  evalAsync<T>(
    `(async () => { ${PRELUDE}
      try { ${body} } catch (e) { return { error: String((e && e.stack) || e) } }
    })()`,
    120_000
  )

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}
interface Report {
  button: Box | null
  slot: Box | null
  tucked: boolean
  under: Box[]
  screen: { width: number; height: number }
}

/** Its place inside the screen, and above everything at the bottom its column meets. */
function standsClear(r: Report): void {
  const b = r.slot!
  expect(b).not.toBeNull()
  expect(b.left).toBeGreaterThanOrEqual(0)
  expect(b.right).toBeLessThanOrEqual(r.screen.width)
  expect(b.top).toBeGreaterThan(r.screen.height / 2)
  expect(r.under.length).toBeGreaterThan(0)
  for (const u of r.under) {
    const sameColumn = u.right > b.left && u.left < b.right
    if (sameColumn) expect(b.bottom).toBeLessThanOrEqual(u.top)
  }
}

describe.skipIf(!available)('the quick button on a phone', () => {
  let savedQuick: unknown = null
  let size: [number, number] = [0, 0]

  beforeAll(async () => {
    attachDebugger()
    const epub = Buffer.from(buildRichEpub()).toString('base64')
    const lines = Array.from(
      { length: 120 },
      (_, i) => `Paragraph ${i + 1}. Some ordinary words to read, long enough to wrap on a phone.`
    ).join('\n\n')
    savedQuick = evalJson<unknown>('window.__abeleTest.AbeleConfig.getInstance().quickButton')
    size = evalJson<[number, number]>(
      `require('@electron/remote').getCurrentWindow().getContentSize()`
    )
    evalRaw(
      `(async () => {
        const old = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (old) await app.vault.delete(old, true)
        await app.vault.createFolder(${JSON.stringify(DIR)})
        await app.vault.create(${JSON.stringify(NOTE)}, ${JSON.stringify(lines)})
        const bytes = Uint8Array.from(atob(${JSON.stringify(epub)}), (c) => c.charCodeAt(0))
        await app.vault.createBinary(${JSON.stringify(BOOK)}, bytes.buffer)
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.quickButton = { enabled: true, tablet: false, side: 'right', lift: 0, actions: [
          { id: 'e2e1', type: 'command', commandId: 'abele:open-documentation', scriptName: '', name: 'Documentation', icon: 'life-buoy' },
        ] }
        await cfg.saveSettings()
        return 'ok'
      })()`,
      60_000
    )
    await reload('app.emulateMobile(true)')
    await setWindowSize(390, 844)
    await reload('window.location.reload()')
  }, 240_000)

  afterAll(async () => {
    evalRaw(
      `(async () => {
        for (const leaf of app.workspace.getLeavesOfType('abele-book')) leaf.detach()
        const cfg = window.__abeleTest.AbeleConfig.getInstance()
        cfg.quickButton = ${JSON.stringify(savedQuick)}
        await cfg.saveSettings()
        const dir = app.vault.getAbstractFileByPath(${JSON.stringify(DIR)})
        if (dir) await app.vault.delete(dir, true)
        return 'ok'
      })()`,
      60_000
    )
    if (size[0]) await setWindowSize(size[0], size[1])
    await reload('app.emulateMobile(false)')
  }, 180_000)

  it('in a note: above the navigation bar, a menu on a tap, tucked by a scroll, gone while typing', () => {
    const r = run<{
      error?: string
      rest?: Report
      menu?: string[]
      scrolled?: Report
      back?: Report
      typing?: boolean
    }>(`
      app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse()
      const leaf = app.workspace.getLeaf(false)
      await leaf.openFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}), { state: { mode: 'preview' } })
      await until(() => fab())
      await wait(800)
      document.activeElement?.blur?.()
      const rest = await report('.mobile-navbar')
      await shoot('note')
      await tapFab()
      await until(() => document.querySelector('.menu'))
      await wait(500)
      const menu = menuTitles()
      await shoot('note-menu')
      await closeMenu()
      const scroller = leaf.view.containerEl.querySelector('.markdown-preview-view')
      for (let i = 0; i < 8; i++) { scroller.scrollTop += 60; await wait(60) }
      const scrolled = await report('.mobile-navbar')
      await shoot('note-tucked')
      for (let i = 0; i < 4; i++) { scroller.scrollTop -= 60; await wait(60) }
      const back = await report('.mobile-navbar')
      await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.getViewState().state, mode: 'source' } })
      await wait(500)
      leaf.view.editor.focus()
      await wait(600)
      const typing = !fab()
      leaf.view.editor.blur?.(); document.activeElement?.blur?.()
      return { rest, menu, scrolled, back, typing }
    `)
    expect(r.error).toBeUndefined()
    standsClear(r.rest!)
    expect(r.rest!.tucked).toBe(false)
    expect(r.menu).toContain('Documentation')
    expect(r.menu).toContain('Command palette')
    expect(r.scrolled!.tucked).toBe(true)
    expect(r.back!.tucked).toBe(false)
    expect(r.typing).toBe(true)
  })

  it('in a book: a sliver above the line under the page, the book’s own items on a tap', () => {
    const r = run<{
      error?: string
      rest?: Report
      menu?: string[]
      turned?: Report
    }>(`
      for (const l of app.workspace.getLeavesOfType('abele-book')) l.detach()
      const leaf = app.workspace.getLeaf(false)
      await leaf.setViewState({ type: 'abele-book', state: { file: ${JSON.stringify(BOOK)} }, active: true })
      const view = leaf.view
      await until(() => view.model?.status === 'ready', 15000)
      // From the first chapter, whatever place an earlier run left the book at.
      await view.engine.goTo(view.model.toc[0].href); await wait(800)
      await until(() => fab())
      await wait(800)
      const rest = await report('.abele-book-reader__foot, .mobile-navbar')
      await shoot('book')
      await tapFab()
      await until(() => document.querySelector('.menu'))
      await wait(500)
      const menu = menuTitles()
      await shoot('book-menu')
      await closeMenu()
      await wait(1500)
      await view.engine.next(); await wait(900)
      await view.engine.next(); await wait(900)
      const turned = await report('.abele-book-reader__foot')
      await shoot('book-tucked')
      leaf.detach()
      return { rest, menu, turned }
    `)
    expect(r.error).toBeUndefined()
    standsClear(r.rest!)
    // The page is text to the edges: it rests as a sliver at the edge, in the margin.
    expect(r.rest!.tucked).toBe(true)
    expect(r.rest!.button!.left).toBeGreaterThanOrEqual(r.rest!.screen.width - 24)
    expect(r.rest!.button!.left).toBeLessThan(r.rest!.screen.width)
    expect(r.menu).toContain('Search in the book')
    expect(r.menu).toContain('Highlights')
    expect(r.turned!.tucked).toBe(true)
  })

  it('over the chat: above its message box, with a new chat in the menu', () => {
    const r = run<{ error?: string; rest?: Report; menu?: string[] }>(`
      app.commands.executeCommandById('abele:show-ai-sidebar')
      await until(() => !app.workspace.rightSplit.collapsed && document.querySelector('.workspace-drawer .abele-chat-input'))
      await wait(1200)
      document.activeElement?.blur?.()
      await until(() => fab())
      const rest = await report('.workspace-drawer .abele-chat-input')
      await shoot('chat')
      await tapFab()
      await until(() => document.querySelector('.menu'))
      await wait(500)
      const menu = menuTitles()
      await shoot('chat-menu')
      await closeMenu()
      app.workspace.rightSplit.collapse()
      return { rest, menu }
    `)
    expect(r.error).toBeUndefined()
    standsClear(r.rest!)
    expect(r.menu).toContain('Start a new chat')
  })
})
