/**
 * The iOS lab's drawing page (`?ink=1`): the sheet laid over a PDF's pages while drawing is on
 * (`inkOverlay.ts`), over four page frames in a scroll, in the real WebKit of iOS Safari. What it
 * reports: every touch the sheet gets and of what kind, how many points a stroke brought, whether
 * anything reached the document (where Obsidian listens), whether the page scrolled by itself, and
 * the strokes drawn. `&finger=1` makes a finger draw, as on a phone; without it a finger moves the
 * pages, as on a tablet with a pen.
 */
import { InkOverlay, type InkPageHit } from '@/reader/ink/inkOverlay'
import { routePointer } from '@/reader/ink/inkRoute'
import { drawInk, pageSizeOf } from '@/reader/ink/inkLayer'
import type { InkPage } from '@/reader/ink/inkFile'

type Log = (e: Record<string, unknown>) => void

export async function inkLab(log: Log, finger: boolean): Promise<void> {
  const stage = document.getElementById('stage')!
  const scroller = document.createElement('div')
  scroller.style.cssText = 'position:absolute;inset:0;overflow:auto;background:#ddd'
  stage.append(scroller)
  const frames: HTMLIFrameElement[] = []
  for (let i = 0; i < 4; i++) {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin allow-scripts')
    frame.style.cssText =
      'display:block;border:0;margin:12px auto;background:#fff;width:360px;height:466px'
    // A PDF page's document as the reader writes it, reduced to what drawing reads: its size.
    const html =
      '<!DOCTYPE html><html><head><meta name="viewport" content="width=612, height=792">' +
      '<style>html,body{margin:0}</style></head><body>' +
      `<p style="font:28px serif;margin:40px">Page ${i + 1}: some words to draw over.</p></body></html>`
    frame.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }))
    scroller.append(frame)
    frames.push(frame)
    await new Promise((r) => frame.addEventListener('load', r, { once: true }))
    frame.contentDocument!.documentElement.style.setProperty('--scale-factor', String(360 / 612))
  }
  const pages = new Map<number, InkPage>()
  // What reaches the document: where Obsidian's own listeners are.
  for (const type of ['touchstart', 'touchmove', 'pointerdown', 'contextmenu', 'click'])
    document.addEventListener(type, () => log({ leaked: type }))
  let lastScroll = 0
  scroller.addEventListener('scroll', () => {
    if (Math.abs(scroller.scrollTop - lastScroll) > 2)
      log({ scrolled: Math.round(scroller.scrollTop) })
    lastScroll = scroller.scrollTop
  })
  let penDown = false
  let moves = 0
  const overlay = new InkOverlay(stage, {
    pageAt: (x, y): InkPageHit | null => {
      for (let i = 0; i < frames.length; i++) {
        const rect = frames[i].getBoundingClientRect()
        const size = pageSizeOf(frames[i].contentDocument!)
        if (size && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
          return { index: i, rect, ...size }
      }
      return null
    },
    route: (e) => {
      const route = routePointer({ finger, penDown }, e)
      log({
        down: e.pointerType,
        route,
        pressure: e.pressure,
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
      })
      moves = 0
      return route
    },
    brush: () => ({ tool: 'pen', color: 'blue', size: 3 }),
    pen: (down) => (penDown = down),
    commit: (index, stroke) => {
      const page = pages.get(index) ?? { width: 612, height: 792, strokes: [] }
      page.strokes.push(stroke)
      pages.set(index, page)
      drawInk(frames[index].contentDocument!, page)
      log({ stroke: index, points: stroke.points.length / 3, moves })
    },
    eraseStart: () => {},
    eraseAt: () => {},
    eraseEnd: () => {},
    pan: (dx, dy) => {
      scroller.scrollBy(dx, dy)
      return true
    },
    turn: () => {},
    zoom: () => {},
  })
  overlay.el.addEventListener('pointermove', () => moves++, true)
  overlay.el.style.setProperty('position', 'absolute')
  overlay.el.style.setProperty('inset', '0')
  overlay.el.style.setProperty('touch-action', 'none')
  overlay.el.style.setProperty('-webkit-user-select', 'none')
  overlay.el.style.setProperty('-webkit-touch-callout', 'none')
  ;(window as unknown as { lab: Record<string, unknown> }).lab.ink = { pages, scroller }
  log({ ready: true, ink: true, finger })
}
