import { BasesView, type QueryController, type BasesPropertyId } from 'obsidian'
import { printMap } from '@/markdown/printMap'
import { mapRows } from './mapRows'
import { t } from '@/i18n'
import { isPrintMode } from '@/markdown/printMode'

const views = new Set<{ container: HTMLElement; ready: Promise<void>; draw(): void }>()
const types = new Set([
  'abele-chart',
  'abele-map',
  'abele-calendar',
  'abele-timeline',
  'abele-find-and-replace',
])

async function attachedPrintViews(
  root: HTMLElement
): Promise<Array<{ container: HTMLElement; ready: Promise<void>; draw(): void }>> {
  const hosts = Array.from(
    root.querySelectorAll<HTMLElement>('.block-language-base, .bases-embed, .internal-embed[src]')
  ).filter(
    (host) =>
      host.matches('.block-language-base, .bases-embed') ||
      /\.base$/i.test((host.getAttribute('src') ?? '').split(/[|#]/)[0])
  )
  if (!hosts.length) return Array.from(views).filter((view) => root.contains(view.container))
  const win = root.ownerDocument.defaultView ?? window
  await new Promise<void>((resolve, reject) => {
    const observer = new win.MutationObserver(scan)
    const timer = win.setTimeout(() => {
      observer.disconnect()
      reject(new Error('PDF base view did not finish loading'))
    }, 15000)
    function scan() {
      const ready = hosts.every((host) => {
        if (host.querySelector('.bases-error, .abele-external-embed')) return true
        const native = host.querySelector<HTMLElement>('.bases-view[data-view-type]')
        if (!native) return false
        if (!types.has(native.dataset.viewType ?? '')) return true
        return Array.from(views).some(
          (view) => native === view.container || native.contains(view.container)
        )
      })
      if (ready) {
        observer.disconnect()
        win.clearTimeout(timer)
        resolve()
      }
    }
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-view-type'],
    })
    scan()
  })
  return Array.from(views).filter((view) => root.contains(view.container))
}

/** Called after the host has finished attaching and querying embedded views. */
export async function renderPrintBases(root: HTMLElement): Promise<void> {
  const win = root.ownerDocument.defaultView ?? window
  const attached = await attachedPrintViews(root)
  await Promise.all(
    attached.map(async (view) => {
      let timer: number | undefined
      try {
        await Promise.race([
          view.ready,
          new Promise((_, reject) => {
            timer = win.setTimeout(() => reject(new Error('PDF data query did not finish')), 15000)
          }),
        ])
        if (root.contains(view.container)) view.draw()
      } finally {
        win.clearTimeout(timer)
      }
    })
  )
}

/** Virtualized, viewport-based views export their complete query as a static table. */
export class PrintView extends BasesView {
  constructor(
    controller: QueryController,
    private readonly container: HTMLElement,
    public type: string
  ) {
    super(controller)
  }

  onDataUpdated(): void {
    renderPrintRows(this, this.container)
  }
}

/** The host constructs a Bases view before attaching its container to the print document. */
export function printableBasesView<T extends BasesView>(view: T, container: HTMLElement): T {
  const update = view.onDataUpdated.bind(view)
  let live = true
  let ready: () => void = () => {}
  const queried = new Promise<void>((resolve) => {
    ready = resolve
  })
  const record = {
    container,
    ready: queried,
    draw: () => {
      if (!live || !view.data) return
      if (view.type === 'abele-chart') update()
      else renderPrintRows(view, container)
    },
  }
  views.add(record)
  view.register(() => {
    live = false
    views.delete(record)
    ready()
  })
  view.onDataUpdated = () => {
    if (isPrintMode(container)) record.draw()
    else update()
    ready()
  }
  return view
}

function renderPrintRows(view: BasesView, container: HTMLElement): void {
  const doc = container.ownerDocument
  container.replaceChildren()
  const order = view.config.getOrder()
  if (view.type === 'abele-map') {
    const rows = mapRows(
      view.data.data,
      {
        coordinates: view.config.getAsPropertyId('coordinates'),
        icon: null,
        color: null,
      },
      order,
      (id) => view.config.getDisplayName(id)
    )
    printMap(container, {
      points: rows.places.map((place) => ({
        lat: place.lat,
        lon: place.lon,
        label: place.title,
      })),
      lines: [],
      height: 320,
      interactive: false,
    })
  }
  const table = container.appendChild(doc.win.createEl('table'))
  table.className = 'abele-print-base'
  table.createEl('caption', { text: t('pdf.rowsFallback') })
  const head = table.createEl('thead').createEl('tr')
  const properties: BasesPropertyId[] = order.length ? order : ['file.name']
  for (const id of properties) head.createEl('th', { text: view.config.getDisplayName(id) })
  const body = table.createEl('tbody')
  for (const entry of view.data.data) {
    const row = body.createEl('tr')
    for (const id of properties) row.createEl('td', { text: entry.getValue(id)?.toString() ?? '' })
  }
}
