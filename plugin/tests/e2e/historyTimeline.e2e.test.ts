/**
 * The history timeline of a base in the running app, with the small history of
 * `tests/fixtures/history/historyNotes.ts`: rulers, thinkers, scientists, artists, events and
 * eras, grouped by `category`, dated the ways people write — `-470`, `490 до н.э.`, `ок. 1450`,
 * `1450?`, `1155–1167`, `XVI век`, `period: 1618–1648`.
 *
 * On a computer: the rows and eras are drawn, BC falls where it should, a name typed in the go-to
 * field picks that person and lists their contemporaries with the years shared, a press on a bar
 * picks it and Escape lets go, Ctrl with the wheel zooms about the pointer, the card over a bar
 * shows its picture, **New note** makes a note with the year written in, and the view is pictured
 * in the light and the dark theme. Then two thousand more notes: the first drawing and a frame of
 * moving about stay quick. On a phone (390×844 under `emulateMobile`, or the real one with
 * `E2E_TARGET=phone`): nothing past the right edge, a finger's tap picks, two fingers zoom.
 * Pictures go to `/tmp/abele-phone/timeline-*.png`.
 *
 * Everything made is removed afterwards, the theme put back: the fixture vault holds `ScaleTest/`
 * and nothing else.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { hasTestApi, isObsidianRunning, evalLong, evalRaw, reloadApp } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import {
  HISTORY_COVERS,
  HISTORY_NOTES,
  historyBase,
  historyNoteText,
} from '../fixtures/history/historyNotes'

targets('desktop', 'phone')

const PHONE = { width: 390, height: 844 }
const SHOTS = '/tmp/abele-phone'
const FOLDER = 'HistoryTimelineE2E'
const PERF = 'HistoryTimelinePerfE2E'
const PERF_NOTES = 2000
const available = isObsidianRunning() && hasTestApi()

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const evalAsync = <T>(script: string, timeoutMs = 120_000): T =>
  JSON.parse(evalRaw(script, timeoutMs)) as T

const FILES: Record<string, string> = {
  ...Object.fromEntries(
    HISTORY_NOTES.map((n) => [`${FOLDER}/Notes/${n.name}.md`, historyNoteText(n)])
  ),
  ...Object.fromEntries(
    Object.entries(HISTORY_COVERS).map(([f, svg]) => [`${FOLDER}/Covers/${f}`, svg])
  ),
  [`${FOLDER}/History.base`]: historyBase(FOLDER),
}

const PRELUDE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (fn, ms) => {
    const deadline = Date.now() + ms
    while (Date.now() < deadline) { const v = fn(); if (v) return v; await wait(100) }
    return null
  }
  const frames = (n = 2) => new Promise((r) => { const step = () => (--n <= 0 ? r() : requestAnimationFrame(step)); requestAnimationFrame(step) })
  const name = (el) => el.tagName.toLowerCase() + '.' + [...el.classList].join('.')
  const overEdge = (root) => {
    const edge = Math.min(root.getBoundingClientRect().right, window.innerWidth)
    const over = []
    for (const el of root.querySelectorAll('*')) {
      const s = getComputedStyle(el)
      if (s.visibility === 'hidden' || s.display === 'none' || s.position === 'absolute' || s.position === 'fixed') continue
      // The chips and the steps are strips a finger scrolls sideways.
      if (el.closest('.abele-timeline-base__legend, .abele-timeline-base__levels')) continue
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.right > edge + 1) over.push(name(el) + ' +' + Math.round(r.right - edge))
    }
    return over.slice(0, 12)
  }
  const picture = async (file) => {
    if (window.__e2eHost) { await window.__e2eHost.shot(${JSON.stringify(SHOTS)} + '/' + file); return file }
    require('fs').mkdirSync(${JSON.stringify(SHOTS)}, { recursive: true })
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const img = await Promise.race([require('@electron/remote').getCurrentWebContents().capturePage(), wait(8000).then(() => null)])
        if (img) { require('fs').writeFileSync(${JSON.stringify(SHOTS)} + '/' + file, img.toPNG()); return file }
      } catch (e) { await wait(500) }
    }
    return 'no picture'
  }
  const setDark = (dark) => {
    document.body.classList.toggle('theme-dark', dark)
    document.body.classList.toggle('theme-light', !dark)
    app.workspace.trigger('css-change')
  }
  const openBase = async (path) => {
    const file = app.vault.getAbstractFileByPath(path)
    if (!file) return null
    const leaf = app.workspace.getLeaf('tab')
    await leaf.openFile(file)
    app.workspace.setActiveLeaf(leaf, { focus: true })
    const root = await until(() => leaf.view.containerEl.querySelector('.abele-timeline-base'), 15000)
    if (!root) return null
    await until(() => root.querySelector('canvas')?.abeleHits?.length, 15000)
    await frames(3)
    return root
  }
  const canvasOf = (root) => root.querySelector('.abele-timeline-canvas__surface')
  const view = (root) => JSON.parse(canvasOf(root).dataset.view)
  const hits = (root) => canvasOf(root).abeleHits || []
  const hitOf = (root, title) => hits(root).find((h) => h.item && h.item.title === title)
  const centre = (root, h) => {
    const box = canvasOf(root).getBoundingClientRect()
    return [box.left + h.x + Math.min(h.w, 30) / 2, box.top + h.y + h.h / 2]
  }
  let pointerId = 10
  const pointer = (root, type, x, y, kind = 'mouse', id = 1) =>
    canvasOf(root).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerType: kind, pointerId: id, isPrimary: id === 1, button: 0, buttons: type === 'pointerup' ? 0 : 1 }))
  const press = async (root, x, y, kind = 'mouse') => {
    pointer(root, 'pointerdown', x, y, kind)
    pointer(root, 'pointerup', x, y, kind)
    await frames(3)
    await wait(150)
  }
  const panel = (root) => root.querySelector('.abele-timeline-panel')
  const panelRows = (root) => [...(panel(root)?.querySelectorAll('.abele-timeline-panel__row') ?? [])].map((r) => r.querySelector('.abele-timeline-panel__name').textContent.trim() + ' ' + r.querySelector('.abele-timeline-panel__together').textContent.trim())
`

const setWindowSize = async (width: number, height: number): Promise<void> => {
  if (onPhone()) return
  evalRaw(
    `(() => { require('@electron/remote').getCurrentWindow().setContentSize(${width}, ${height}); return 'ok' })()`,
    30_000
  )
  await pause(1500)
}

interface Desktop {
  error?: string
  badges?: string[]
  undated?: string | null
  eras?: string[]
  drawn?: number
  socratesX?: [number, number]
  picked?: string
  contemporaries?: string[]
  pressed?: string
  afterEscape?: boolean
  zoomKept?: [number, number]
  ppy?: [number, number]
  card?: { title: string; cover: boolean; lines: string[] }
  created?: { path: string; year: unknown } | null
  decades?: number
  shots?: string[]
}

interface Perf {
  error?: string
  firstDrawMs?: number
  frameMs?: number
  overflow?: number[]
}

interface Phone {
  error?: string
  phone?: boolean
  over?: string[]
  canvas?: [number, number]
  picked?: string
  rows?: number
  ppy?: [number, number]
  shots?: string[]
}

describe.skipIf(!available)('the history timeline of a base', () => {
  let size: [number, number] = [0, 0]
  let desktop: Desktop = {}
  let perf: Perf = {}
  let phone: Phone = {}

  beforeAll(async () => {
    evalAsync(`(async () => {
      for (const dir of ${JSON.stringify([FOLDER, `${FOLDER}/Notes`, `${FOLDER}/Covers`])})
        if (!(await app.vault.adapter.exists(dir))) await app.vault.adapter.mkdir(dir)
      const files = ${JSON.stringify(FILES)}
      for (const [path, content] of Object.entries(files))
        if (!app.vault.getAbstractFileByPath(path)) await app.vault.create(path, content)
      return '"made"'
    })()`)
    await pause(2500)

    if (!onPhone()) {
      desktop = evalAsync<Desktop>(`(async () => {
        ${PRELUDE}
        const report = { shots: [] }
        const wasDark = document.body.classList.contains('theme-dark')
        try {
          setDark(false)
          const root = await openBase(${JSON.stringify(`${FOLDER}/History.base`)})
          if (!root) return { error: 'the timeline did not open' }
          report.badges = [...root.querySelectorAll('.abele-timeline-base__legend .abele-badge')].map((b) => b.textContent.trim())
          report.undated = root.querySelector('.abele-timeline-base__undated')?.textContent.trim() ?? null
          report.eras = hits(root).filter((h) => h.kind === 'era').map((h) => h.item.title)
          report.drawn = hits(root).filter((h) => h.kind === 'item').length
          const v = view(root)
          const s = hitOf(root, 'Сократ')
          // 470 BC is year -469 on the line: no year zero.
          if (s) report.socratesX = [Math.round(s.x), Math.round(v.labelW + (-469 - v.t0) * v.ppy)]
          report.shots.push(await picture('timeline-desktop-light.png'))

          // A name typed in the go-to field picks that person.
          const go = root.querySelector('.abele-timeline-base__go')
          go.value = 'Шекспир'
          go.dispatchEvent(new Event('input', { bubbles: true }))
          go.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          await until(() => panel(root), 3000)
          await frames(3)
          report.picked = panel(root)?.dataset.selected
          report.contemporaries = panelRows(root)
          report.shots.push(await picture('timeline-desktop-contemporaries.png'))
          setDark(true)
          await wait(300)
          await frames(3)
          report.shots.push(await picture('timeline-desktop-dark-contemporaries.png'))
          canvasOf(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          await frames(3)
          report.afterEscape = !panel(root)

          // Decades: bars long enough for their names and pictures.
          const tab = [...root.querySelectorAll('.abele-timeline-base__levels .abele-tabs__tab')].find((t) => t.textContent.trim() === 'Decades')
          tab?.click()
          await frames(3)
          // Onto the sixteenth century, where the pictures are.
          go.value = '1560'
          go.dispatchEvent(new Event('input', { bubbles: true }))
          go.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          await wait(300)
          await frames(3)
          report.decades = view(root).ppy
          report.shots.push(await picture('timeline-desktop-dark-decades.png'))
          setDark(false)
          await wait(300)
          await frames(3)
          report.shots.push(await picture('timeline-desktop-light-decades.png'))

          // A press on a bar picks it.
          const g = hitOf(root, 'Галилей')
          if (g) {
            const [x, y] = centre(root, g)
            await press(root, x, y)
            report.pressed = panel(root)?.dataset.selected
            // The card over a bar, with its round picture.
            canvasOf(root).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            await frames(2)
            const g2 = await until(() => hitOf(root, 'Галилей'), 3000)
            const [hx, hy] = centre(root, g2)
            pointer(root, 'pointermove', hx, hy)
            const card = await until(() => document.querySelector('.abele-timeline-card'), 2000)
            const img = card?.querySelector('img')
            if (img) await until(() => img.complete && img.naturalWidth > 0, 3000)
            report.card = card ? {
              title: card.querySelector('.abele-timeline-card__title').textContent.trim(),
              cover: !!img && img.naturalWidth > 0,
              lines: [...card.querySelectorAll('.abele-timeline-card__line, .abele-timeline-card__dates')].map((l) => l.textContent.trim()),
            } : null
            report.shots.push(await picture('timeline-desktop-card.png'))
            pointer(root, 'pointerleave', 0, 0)
          }

          // Ctrl with the wheel zooms about the pointer: the year under it stays put.
          const box = canvasOf(root).getBoundingClientRect()
          const px = box.left + v.labelW + 200
          const before = view(root)
          const tBefore = before.t0 + (px - box.left - before.labelW) / before.ppy
          canvasOf(root).dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -60, clientX: px, clientY: box.top + 120 }))
          await frames(2)
          const after = view(root)
          const tAfter = after.t0 + (px - box.left - after.labelW) / after.ppy
          report.zoomKept = [Math.round(tBefore * 100) / 100, Math.round(tAfter * 100) / 100]
          report.ppy = [before.ppy, after.ppy]

          // New note: made through the base, with the year written into the start.
          const known = new Set(app.vault.getMarkdownFiles().map((f) => f.path))
          const button = root.querySelector('.abele-timeline-base__new')
          button?.click()
          const made = await until(() => app.vault.getMarkdownFiles().find((f) => !known.has(f.path)), 5000)
          if (made) {
            await until(() => app.metadataCache.getFileCache(made)?.frontmatter, 3000)
            const fm = app.metadataCache.getFileCache(made)?.frontmatter ?? {}
            report.created = { path: made.path, year: fm.born ?? fm.start ?? null }
            // Obsidian's own box for the new note's name is left open: closed, then the note goes.
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
            await wait(300)
            for (const pop of document.querySelectorAll('.popover')) pop.remove()
            const still = app.vault.getAbstractFileByPath(made.path)
            if (still) await app.vault.delete(still)
          } else report.created = null
        } catch (e) {
          report.error = String((e && e.message) || e) + ' | ' + String(e && e.stack)
        } finally {
          setDark(wasDark)
        }
        return JSON.stringify(report)
      })()`)

      // Two thousand more people, over three thousand years.
      perf = evalAsync<Perf>(
        `(async () => {
        ${PRELUDE}
        const report = {}
        try {
          await app.vault.adapter.mkdir(${JSON.stringify(PERF)})
          const writes = []
          for (let i = 0; i < ${PERF_NOTES}; i++) {
            const born = -1000 + Math.round((i * 3037) % 3000)
            const group = ['A', 'B', 'C', 'D'][i % 4]
            writes.push(app.vault.create(${JSON.stringify(PERF)} + '/Person ' + i + '.md', '---\\ngroup: ' + group + '\\nborn: ' + born + '\\ndied: ' + (born + 30 + (i % 50)) + '\\n---\\n'))
          }
          await Promise.all(writes)
          await app.vault.create(${JSON.stringify(`${PERF}/Perf.base`)}, 'filters:\\n  and:\\n    - file.inFolder("${PERF}")\\nviews:\\n  - type: abele-timeline\\n    name: Many\\n    groupBy:\\n      property: note.group\\n      direction: ASC\\n')
          await wait(3000)
          const started = performance.now()
          const root = await openBase(${JSON.stringify(`${PERF}/Perf.base`)})
          if (!root) return { error: 'the big timeline did not open' }
          report.firstDrawMs = Math.round(performance.now() - started)
          report.overflow = view(root).overflow
          await picture('timeline-desktop-many.png')
          const box = canvasOf(root).getBoundingClientRect()
          const t0 = performance.now()
          // Back and forth, so the view stays over the notes.
          for (let i = 0; i < 20; i++) {
            canvasOf(root).dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: i < 10 ? 20 : -20, clientX: box.left + 300, clientY: box.top + 100 }))
            await frames(1)
          }
          report.frameMs = Math.round((performance.now() - t0) / 20)
        } catch (e) {
          report.error = String((e && e.message) || e) + ' | ' + String(e && e.stack)
        }
        return JSON.stringify(report)
      })()`,
        300_000
      )

      size = JSON.parse(
        evalRaw(`JSON.stringify(require('@electron/remote').getCurrentWindow().getContentSize())`)
      ) as [number, number]
      await reloadApp('app.emulateMobile(true)')
      await setWindowSize(PHONE.width, PHONE.height)
      await reloadApp('window.location.reload()')
    }

    // Started and asked after on a phone, whose real pinch and tap take their time.
    phone = JSON.parse(
      await evalLong(
        `(async () => {
      ${PRELUDE}
      const report = { phone: document.body.classList.contains('is-phone'), shots: [] }
      try {
        app.workspace.leftSplit?.collapse?.()
        app.workspace.rightSplit?.collapse?.()
        const root = await openBase(${JSON.stringify(`${FOLDER}/History.base`)})
        if (!root) return { ...report, error: 'the timeline did not open' }
        await wait(600)
        const c = canvasOf(root)
        report.canvas = [c.clientWidth, c.clientHeight]
        report.over = overEdge(root)
        report.shots.push(await picture('timeline-phone.png'))
        // Two fingers drawn apart zoom in: a real pinch in the middle of the screen on a phone.
        const host = window.__e2eHost
        const box = c.getBoundingClientRect()
        const before = view(root).ppy
        if (host) await host.pinch(2)
        else {
          const y = box.top + box.height / 3
          pointer(root, 'pointerdown', box.left + 150, y, 'touch', 21)
          pointer(root, 'pointerdown', box.left + 230, y, 'touch', 22)
          for (let i = 1; i <= 5; i++) {
            pointer(root, 'pointermove', box.left + 150 - i * 15, y, 'touch', 21)
            pointer(root, 'pointermove', box.left + 230 + i * 15, y, 'touch', 22)
            await frames(1)
          }
          pointer(root, 'pointerup', box.left + 75, y, 'touch', 21)
          pointer(root, 'pointerup', box.left + 305, y, 'touch', 22)
        }
        await wait(300)
        await frames(2)
        report.ppy = [before, view(root).ppy]
        report.shots.push(await picture('timeline-phone-pinched.png'))
        // Centuries: the bars of the Renaissance are wide enough for a finger.
        const tab = [...root.querySelectorAll('.abele-timeline-base__levels .abele-tabs__tab')].find((t) => t.textContent.trim() === 'Centuries')
        tab?.click()
        const go = root.querySelector('.abele-timeline-base__go')
        go.value = '1580'
        go.dispatchEvent(new Event('input', { bubbles: true }))
        go.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        go.blur()
        await wait(300)
        await frames(3)
        const s = hitOf(root, 'Шекспир')
        if (s) {
          const [x, y] = centre(root, s)
          // A finger on a phone; a touch pointer where there is none.
          // The host's answer can be lost on the way back while the tap itself lands: the pick
          // is what is checked.
          if (host) await host.tap(x, y).catch((e) => (report.tapError = String((e && e.message) || e)))
          else await press(root, x, y, 'touch')
          await until(() => panel(root), 3000)
          await wait(300)
          report.picked = panel(root)?.dataset.selected
          report.rows = panelRows(root).length
          report.over = [...report.over, ...overEdge(root)]
          report.shots.push(await picture('timeline-phone-contemporaries.png'))
        }
      } catch (e) {
        report.error = String((e && e.message) || e) + ' | ' + String(e && e.stack)
      }
      return JSON.stringify(report)
    })()`,
        170_000
      )
    ) as Phone
    console.info(`\n  ${JSON.stringify({ desktop, perf, phone })}\n`)
  }, 600_000)

  afterAll(async () => {
    if (!available) return
    try {
      evalRaw(
        `(async () => {
          for (const leaf of app.workspace.getLeavesOfType('bases')) {
            const p = leaf.view.file?.path ?? ''
            if (p.startsWith(${JSON.stringify(FOLDER + '/')}) || p.startsWith(${JSON.stringify(PERF + '/')})) leaf.detach()
          }
          for (const dir of ${JSON.stringify([FOLDER, PERF])}) {
            const folder = app.vault.getAbstractFileByPath(dir)
            if (folder) await app.vault.delete(folder, true)
          }
          return 'removed'
        })()`,
        120_000
      )
    } catch (e) {
      console.warn('[abele e2e] history timeline fixture not removed', e)
    }
    if (!onPhone()) {
      if (size[0]) await setWindowSize(size[0], size[1])
      await reloadApp('app.emulateMobile(false)')
    }
  }, 240_000)

  it.skipIf(onPhone())('draws the rows, the eras, and BC where it falls', () => {
    expect(desktop.error).toBeUndefined()
    expect(desktop.badges).toEqual(['Искусство', 'Мыслители', 'Правители', 'События', 'Учёные'])
    expect(desktop.undated).toBeNull()
    expect(desktop.eras).toEqual(expect.arrayContaining(['Античность', 'Средние века']))
    // What is on screen: the rows below the fold are scrolled to, not drawn.
    expect(desktop.drawn ?? 0).toBeGreaterThanOrEqual(15)
    const [drawn, expected] = desktop.socratesX ?? [0, 99]
    expect(Math.abs(drawn - expected)).toBeLessThanOrEqual(1)
  })

  it.skipIf(onPhone())('picks a person by name and lists who lived at the same time', () => {
    expect(desktop.picked).toBe(`${FOLDER}/Notes/Шекспир.md`)
    expect(desktop.contemporaries).toEqual(
      expect.arrayContaining(['Галилей 52 years', 'Сервантес 52 years', 'Кеплер 45 years'])
    )
    expect(desktop.contemporaries?.some((r) => r.startsWith('Данте'))).toBe(false)
    expect(desktop.afterEscape).toBe(true)
  })

  it.skipIf(onPhone())('picks a bar pressed, and shows its card with the picture', () => {
    expect(desktop.pressed).toBe(`${FOLDER}/Notes/Галилей.md`)
    expect(desktop.card?.title).toBe('Галилей')
    expect(desktop.card?.cover).toBe(true)
    expect(desktop.card?.lines).toEqual(expect.arrayContaining(['1564 – 1642', 'Lived 78 years']))
  })

  it.skipIf(onPhone())('zooms about the pointer and makes a note at a year', () => {
    const [a, b] = desktop.ppy ?? [1, 1]
    expect(b).toBeGreaterThan(a)
    const [before, after] = desktop.zoomKept ?? [0, 99]
    expect(Math.abs(before - after)).toBeLessThan(0.5)
    expect(desktop.created).not.toBeNull()
    expect(typeof desktop.created?.year).toBe('number')
  })

  it.skipIf(onPhone())('draws two thousand notes quickly', () => {
    expect(perf.error).toBeUndefined()
    expect(perf.firstDrawMs ?? Infinity).toBeLessThan(5000)
    expect(perf.frameMs ?? Infinity).toBeLessThan(80)
  })

  it('on a phone: nothing past the edge, a tap picks, two fingers zoom', () => {
    expect(phone.error).toBeUndefined()
    expect(phone.phone).toBe(true)
    expect(phone.over).toEqual([])
    expect(phone.canvas?.[0] ?? Infinity).toBeLessThanOrEqual(PHONE.width)
    expect(phone.picked).toBe(`${FOLDER}/Notes/Шекспир.md`)
    expect(phone.rows ?? 0).toBeGreaterThan(3)
    const [a, b] = phone.ppy ?? [1, 1]
    expect(b).toBeGreaterThan(a * 1.3)
  })
})
