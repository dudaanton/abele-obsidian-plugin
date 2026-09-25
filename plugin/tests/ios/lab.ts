/**
 * The iOS lab: the reader's engine and its page wiring (`pageInput.ts`), without Obsidian, in a
 * page iOS Safari opens in the Simulator — the real WebKit, with its own long press, selection
 * handles and scrolling, which no emulation in Chromium has. How to run it: `docs/Testing.md`.
 *
 * Everything it sees is sent to the lab server as it happens (`/log`), and the server can ask it
 * to do things (`/next`), so a test on the Mac reads what happened on the phone.
 */
import { frameOptions } from '@/vendor/foliate-js/frame-options.js'
import { tagName } from '@/vendor/foliate-js/elements.js'
import type { View as FoliateView } from '@/vendor/foliate-js/view.js'
import { openEpub } from '@/reader/openBook'
import { watchPage, type PageHost } from '@/reader/pageInput'
import { emptyBookModel } from '@/reader/model'
import { layoutAttributes, pageStyles, readerSettingsFrom } from '@/reader/settings'

type Entry = Record<string, unknown>
const queue: Entry[] = []
const log = (e: Entry) => queue.push({ t: Math.round(performance.now()), ...e })
setInterval(() => {
  if (!queue.length) return
  const body = JSON.stringify(queue.splice(0))
  void fetch('/log', { method: 'POST', body })
}, 100)
;(window as unknown as { lab: unknown }).lab = { log }

async function main() {
  const params = new URLSearchParams(location.search)
  const flow = params.get('flow') === 'scrolled' ? 'scrolled' : 'paginated'
  const data = new Uint8Array(await (await fetch(params.get('book') ?? '/book.epub')).arrayBuffer())
  const opened = await openEpub(data)
  await import('@/vendor/foliate-js/view.js')
  // The iPhone's sandbox: WebKit delivers no events into a frame without scripts.
  frameOptions.sandbox = 'allow-same-origin allow-scripts'
  const stage = document.getElementById('stage')!
  const reader = document.createElement(tagName('foliate-view')) as unknown as FoliateView &
    HTMLElement
  reader.style.cssText = 'display:block;width:100%;height:100%'
  stage.append(reader)
  const model = emptyBookModel()
  ;(window as unknown as { model: unknown; reader: unknown }).model = model
  ;(window as unknown as { reader: unknown }).reader = reader
  const host: PageHost = {
    reader: () => reader,
    stage: () => stage,
    reading: () => null,
    model,
    pdf: false,
    fixed: () => false,
    zoom: () => {},
  }
  reader.addEventListener('load', (e) => {
    const { doc } = (e as CustomEvent<{ doc: Document }>).detail
    watchPage(host, doc)
    // What WebKit tells the page of a finger: which events reach it, and where.
    let moves = 0
    for (const type of [
      'touchstart',
      'touchend',
      'touchcancel',
      'pointerdown',
      'pointerup',
      'pointercancel',
    ])
      doc.addEventListener(
        type,
        (e) => {
          const t = (e as TouchEvent).changedTouches?.[0] ?? (e as PointerEvent)
          log({ ev: type, x: Math.round(t.clientX), y: Math.round(t.clientY), moves })
          if (type.endsWith('start') || type.endsWith('down')) moves = 0
        },
        true
      )
    doc.addEventListener('touchmove', () => moves++, true)
    let last = ''
    doc.addEventListener('selectionchange', () => {
      const sel = doc.getSelection()
      const text = sel && !sel.isCollapsed ? sel.toString() : ''
      const words = text.trim() ? text.trim().split(/\s+/) : []
      const now = `${words.length}:${words[0] ?? ''}:${words[words.length - 1] ?? ''}`
      if (now === last) return
      last = now
      model.selection = text ? { cfi: 'lab', text, label: '' } : null
      log({ sel: now, scroll: scrollOf() })
    })
  })
  // Where the page container is scrolled to: the engine's own account of it (its root is closed).
  const scrollOf = () => {
    const r = reader.renderer as unknown as { start?: number }
    return typeof r?.start === 'number' ? Math.round(r.start) : null
  }
  reader.addEventListener('relocate', (e) => {
    const d = (e as CustomEvent<{ reason?: string; fraction?: number }>).detail
    log({
      relocate: d.reason ?? '',
      page: (reader.renderer as unknown as { page?: number }).page,
      scroll: scrollOf(),
    })
  })
  // The bar under the page, as the reader shows it: for words selected, and not while they are
  // still being selected.
  let barShown = false
  setInterval(() => {
    const show = !!model.selection && !model.selecting
    document.getElementById('bar')!.style.display = show ? 'block' : 'none'
    if (show !== barShown) log({ bar: show })
    barShown = show
  }, 50)
  await reader.open(opened.book)
  const settings = readerSettingsFrom({ flow })
  for (const [k, v] of Object.entries(layoutAttributes(settings, true)))
    (reader.renderer as unknown as HTMLElement).setAttribute(k, v)
  ;(reader.renderer as unknown as { setStyles(s: [string, string]): void }).setStyles(
    pageStyles(settings, {
      text: '#222',
      background: '#fff',
      accent: '#06c',
      selection: 'rgba(80,120,255,.35)',
      fontText: '',
      dark: false,
    })
  )
  await reader.goTo(opened.book.toc?.[0]?.href ?? 0)
  // Every change of where the page container is scrolled, however it came about.
  let lastScroll = scrollOf()
  reader.renderer.addEventListener('scroll', () => {
    const now = scrollOf()
    if (now !== lastScroll) log({ scrolled: now, from: lastScroll })
    lastScroll = now
  })
  log({
    ready: true,
    flow,
    page: (reader.renderer as unknown as { page?: number }).page,
    scroll: scrollOf(),
  })
  // Orders from the lab server: go to a page, clear the selection, report.
  setInterval(async () => {
    const res = await fetch('/next')
    const order = (await res.json()) as Entry | null
    if (!order) return
    if (order.page !== undefined) {
      await reader.goTo(opened.book.toc?.[0]?.href ?? 0)
      for (let i = 0; i < Number(order.page); i++) await reader.renderer.next()
    }
    if (order.clear)
      for (const x of reader.renderer.getContents()) x.doc.getSelection()?.removeAllRanges()
    if (order.report) {
      const doc = reader.renderer.getContents()[0]?.doc
      const sel = doc?.getSelection()
      log({
        report: true,
        page: (reader.renderer as unknown as { page?: number }).page,
        scroll: scrollOf(),
        selection: sel?.toString() ?? '',
        bar: !!model.selection && !model.selecting,
      })
    }
  }, 150)
}

main().catch((e) => log({ error: String((e as Error)?.stack ?? e) }))
