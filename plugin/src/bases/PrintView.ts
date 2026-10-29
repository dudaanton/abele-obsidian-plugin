import { BasesView, type QueryController, type BasesPropertyId } from 'obsidian'
import { printMap } from '@/markdown/printMap'
import { mapRows } from './mapRows'
import { t } from '@/i18n'

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
    const doc = this.container.ownerDocument
    this.container.replaceChildren()
    const order = this.config.getOrder()
    if (this.type === 'abele-map') {
      const rows = mapRows(
        this.data.data,
        {
          coordinates: this.config.getAsPropertyId('coordinates'),
          icon: null,
          color: null,
        },
        order,
        (id) => this.config.getDisplayName(id)
      )
      printMap(this.container, {
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
    const table = this.container.appendChild(doc.win.createEl('table'))
    table.className = 'abele-print-base'
    table.createEl('caption', { text: t('pdf.rowsFallback') })
    const head = table.createEl('thead').createEl('tr')
    const properties: BasesPropertyId[] = order.length ? order : ['file.name']
    for (const id of properties) head.createEl('th', { text: this.config.getDisplayName(id) })
    const body = table.createEl('tbody')
    for (const entry of this.data.data) {
      const row = body.createEl('tr')
      for (const id of properties)
        row.createEl('td', { text: entry.getValue(id)?.toString() ?? '' })
    }
  }
}
