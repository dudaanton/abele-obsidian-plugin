/**
 * Lightweight SVG chart rendering utilities for Bases views.
 * No external dependencies.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

interface ChartPadding {
  top: number
  right: number
  bottom: number
  left: number
}

function createSvgElement(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value))
  }
  return el
}

function getCssVar(name: string): string {
  return getComputedStyle(document.body).getPropertyValue(name).trim()
}

// --- Line Chart ---

export interface LineChartSeries {
  label: string
  data: Array<{ x: string; y: number }>
  color?: string
}

const LINE_COLORS = [
  'var(--interactive-accent)',
  'var(--text-success)',
  'var(--text-error)',
  'var(--text-warning)',
  '#8b5cf6',
  '#06b6d4',
  '#f97316',
  '#ec4899',
]

export function renderLineChart(
  container: HTMLElement,
  seriesList: LineChartSeries[],
  opts: { height?: number } = {}
): void {
  container.empty()
  if (!seriesList.length || seriesList.every((s) => !s.data.length)) {
    container.createEl('div', {
      text: 'No data',
      cls: 'abele-bases-chart__empty',
    })
    return
  }

  const height = opts.height || 240
  const padding: ChartPadding = { top: 20, right: 20, bottom: 40, left: 60 }

  const wrapper = container.createDiv({ cls: 'abele-bases-chart' })
  wrapper.style.width = '100%'

  // Collect all x labels and y range
  const allX = new Set<string>()
  let yMin = Infinity
  let yMax = -Infinity
  for (const series of seriesList) {
    for (const pt of series.data) {
      allX.add(pt.x)
      if (pt.y < yMin) yMin = pt.y
      if (pt.y > yMax) yMax = pt.y
    }
  }

  const xLabels = Array.from(allX).sort()
  if (yMin === yMax) {
    yMin -= 1
    yMax += 1
  }
  const yPad = (yMax - yMin) * 0.05
  yMin -= yPad
  yMax += yPad

  const svg = createSvgElement('svg', {
    width: '100%',
    height,
    viewBox: `0 0 800 ${height}`,
    preserveAspectRatio: 'none',
  }) as SVGSVGElement
  svg.style.display = 'block'

  const chartW = 800 - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  const xScale = (i: number) => padding.left + (i / Math.max(xLabels.length - 1, 1)) * chartW
  const yScale = (v: number) => padding.top + chartH - ((v - yMin) / (yMax - yMin)) * chartH

  // Grid lines
  const gridCount = 5
  for (let i = 0; i <= gridCount; i++) {
    const y = padding.top + (i / gridCount) * chartH
    const val = yMax - (i / gridCount) * (yMax - yMin)
    svg.appendChild(
      createSvgElement('line', {
        x1: padding.left,
        y1: y,
        x2: 800 - padding.right,
        y2: y,
        stroke: 'var(--background-modifier-border)',
        'stroke-width': 1,
      })
    )
    const text = createSvgElement('text', {
      x: padding.left - 8,
      y: y + 4,
      fill: 'var(--text-faint)',
      'font-size': 11,
      'text-anchor': 'end',
    })
    text.textContent = formatCompact(val)
    svg.appendChild(text)
  }

  // X labels (show ~6 evenly spaced)
  const xLabelCount = Math.min(6, xLabels.length)
  for (let i = 0; i < xLabelCount; i++) {
    const idx = Math.round((i / Math.max(xLabelCount - 1, 1)) * (xLabels.length - 1))
    const text = createSvgElement('text', {
      x: xScale(idx),
      y: height - 8,
      fill: 'var(--text-faint)',
      'font-size': 11,
      'text-anchor': 'middle',
    })
    text.textContent = formatDateLabel(xLabels[idx])
    svg.appendChild(text)
  }

  // Series
  for (let si = 0; si < seriesList.length; si++) {
    const series = seriesList[si]
    const color = series.color || LINE_COLORS[si % LINE_COLORS.length]
    const xMap = new Map(xLabels.map((x, i) => [x, i]))

    const points = series.data
      .map((pt) => ({ xi: xMap.get(pt.x)!, y: pt.y }))
      .filter((p) => p.xi !== undefined)
      .sort((a, b) => a.xi - b.xi)

    if (points.length < 2) continue

    const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.xi)},${yScale(p.y)}`).join(' ')

    svg.appendChild(
      createSvgElement('path', {
        d,
        fill: 'none',
        stroke: color,
        'stroke-width': 2,
        'stroke-linejoin': 'round',
      })
    )
  }

  wrapper.appendChild(svg)

  // Legend
  if (seriesList.length > 1) {
    const legend = wrapper.createDiv({ cls: 'abele-bases-chart__legend' })
    for (let si = 0; si < seriesList.length; si++) {
      const item = legend.createDiv({ cls: 'abele-bases-chart__legend-item' })
      const swatch = item.createSpan({ cls: 'abele-bases-chart__legend-swatch' })
      swatch.style.backgroundColor = seriesList[si].color || LINE_COLORS[si % LINE_COLORS.length]
      item.createSpan({ text: seriesList[si].label })
    }
  }
}

// --- Horizontal Bar Chart ---

export interface BarChartItem {
  label: string
  value: number
  color?: string
}

const BAR_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#a78bfa',
  '#c4b5fd',
  '#06b6d4',
  '#14b8a6',
  '#10b981',
  '#22c55e',
  '#f97316',
  '#ef4444',
  '#ec4899',
  '#f59e0b',
]

export function renderBarChart(container: HTMLElement, items: BarChartItem[]): void {
  container.empty()
  if (!items.length) {
    container.createEl('div', {
      text: 'No data',
      cls: 'abele-bases-chart__empty',
    })
    return
  }

  const maxVal = Math.max(...items.map((i) => Math.abs(i.value)), 1)
  const wrapper = container.createDiv({ cls: 'abele-bases-chart abele-bases-chart--bars' })

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const row = wrapper.createDiv({ cls: 'abele-bases-bar__row' })

    const label = row.createDiv({ cls: 'abele-bases-bar__label' })
    label.textContent = item.label

    const barContainer = row.createDiv({ cls: 'abele-bases-bar__track' })
    const bar = barContainer.createDiv({ cls: 'abele-bases-bar__fill' })
    const pct = (Math.abs(item.value) / maxVal) * 100
    bar.style.width = `${pct}%`
    bar.style.backgroundColor = item.color || BAR_COLORS[i % BAR_COLORS.length]

    const valueEl = row.createDiv({ cls: 'abele-bases-bar__value' })
    valueEl.textContent = formatCompact(item.value)
  }
}

// --- Calendar Heatmap ---

export interface CalendarDay {
  date: string // YYYY-MM-DD
  value: number
}

export function renderCalendarHeatmap(container: HTMLElement, days: CalendarDay[]): void {
  container.empty()
  if (!days.length) {
    container.createEl('div', {
      text: 'No data',
      cls: 'abele-bases-chart__empty',
    })
    return
  }

  const wrapper = container.createDiv({ cls: 'abele-bases-chart abele-bases-calendar' })

  const dayMap = new Map(days.map((d) => [d.date, d.value]))
  const maxVal = Math.max(...days.map((d) => Math.abs(d.value)), 1)
  const sortedDates = days.map((d) => d.date).sort()
  const startDate = sortedDates[0]
  const endDate = sortedDates[sortedDates.length - 1]

  // Build weeks
  const cellSize = 14
  const cellGap = 2
  const headerH = 20
  const dayLabelW = 24

  // Calculate how many weeks to display
  const start = new Date(startDate)
  const end = new Date(endDate)

  // Align start to beginning of week (Sunday)
  const startDay = start.getDay()
  start.setDate(start.getDate() - startDay)

  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 7
  const weeks = Math.ceil(totalDays / 7)

  const svgW = dayLabelW + weeks * (cellSize + cellGap)
  const svgH = headerH + 7 * (cellSize + cellGap)

  const svg = createSvgElement('svg', {
    width: svgW,
    height: svgH,
  }) as SVGSVGElement

  // Day labels
  const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  for (let d = 0; d < 7; d++) {
    if (d % 2 === 0) {
      const text = createSvgElement('text', {
        x: dayLabelW - 4,
        y: headerH + d * (cellSize + cellGap) + cellSize - 2,
        fill: 'var(--text-faint)',
        'font-size': 10,
        'text-anchor': 'end',
      })
      text.textContent = dayNames[d]
      svg.appendChild(text)
    }
  }

  // Cells
  const current = new Date(start)
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const dateStr = current.toISOString().slice(0, 10)
      const val = dayMap.get(dateStr) || 0

      const x = dayLabelW + w * (cellSize + cellGap)
      const y = headerH + d * (cellSize + cellGap)

      const intensity = val === 0 ? 0 : Math.min(Math.abs(val) / maxVal, 1)
      const fill = val === 0 ? 'var(--background-modifier-border)' : heatColor(intensity)

      const rect = createSvgElement('rect', {
        x,
        y,
        width: cellSize,
        height: cellSize,
        rx: 2,
        fill,
      })

      // Tooltip via title
      const title = createSvgElement('title')
      title.textContent = `${dateStr}: ${formatCompact(val)}`
      rect.appendChild(title)

      svg.appendChild(rect)
      current.setDate(current.getDate() + 1)
    }
  }

  // Month labels
  const cur2 = new Date(start)
  let lastMonth = -1
  for (let w = 0; w < weeks; w++) {
    const month = cur2.getMonth()
    if (month !== lastMonth) {
      lastMonth = month
      const text = createSvgElement('text', {
        x: dayLabelW + w * (cellSize + cellGap),
        y: 12,
        fill: 'var(--text-faint)',
        'font-size': 10,
      })
      text.textContent = cur2.toLocaleString('default', { month: 'short' })
      svg.appendChild(text)
    }
    cur2.setDate(cur2.getDate() + 7)
  }

  wrapper.style.overflowX = 'auto'
  wrapper.appendChild(svg)
}

// --- Stat Card ---

export function renderStatCard(
  container: HTMLElement,
  label: string,
  value: number,
  currency?: string,
  trend?: Array<{ x: string; y: number }>
): void {
  container.empty()
  const wrapper = container.createDiv({ cls: 'abele-bases-chart abele-bases-stat' })

  const labelEl = wrapper.createDiv({ cls: 'abele-bases-stat__label' })
  labelEl.textContent = label

  const valueEl = wrapper.createDiv({ cls: 'abele-bases-stat__value' })
  valueEl.textContent = formatCompact(value) + (currency ? ` ${currency}` : '')

  if (trend && trend.length > 1) {
    const sparkContainer = wrapper.createDiv({ cls: 'abele-bases-stat__spark' })
    renderSparkline(sparkContainer, trend)
  }
}

function renderSparkline(container: HTMLElement, data: Array<{ x: string; y: number }>): void {
  const width = 200
  const height = 40
  const sorted = [...data].sort((a, b) => a.x.localeCompare(b.x))

  let yMin = Infinity
  let yMax = -Infinity
  for (const pt of sorted) {
    if (pt.y < yMin) yMin = pt.y
    if (pt.y > yMax) yMax = pt.y
  }
  if (yMin === yMax) {
    yMin -= 1
    yMax += 1
  }

  const svg = createSvgElement('svg', { width, height }) as SVGSVGElement

  const xStep = width / Math.max(sorted.length - 1, 1)
  const yRange = yMax - yMin

  const points = sorted.map((pt, i) => `${i * xStep},${height - ((pt.y - yMin) / yRange) * height}`)

  svg.appendChild(
    createSvgElement('polyline', {
      points: points.join(' '),
      fill: 'none',
      stroke: 'var(--interactive-accent)',
      'stroke-width': 1.5,
    })
  )

  container.appendChild(svg)
}

// --- Helpers ---

function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(n) >= 10_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateLabel(dateStr: string): string {
  // YYYY-MM-DD → "Jan 15" or "2024-01"
  if (dateStr.length === 10) {
    const d = new Date(dateStr)
    return d.toLocaleString('default', { month: 'short', day: 'numeric' })
  }
  return dateStr
}

function heatColor(intensity: number): string {
  // Green scale for expense amounts
  const r = Math.round(34 + (1 - intensity) * 180)
  const g = Math.round(197 - intensity * 100)
  const b = Math.round(94 - intensity * 50)
  return `rgb(${r}, ${g}, ${b})`
}
