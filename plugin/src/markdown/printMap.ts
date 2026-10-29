import type { MapConfig } from '@/helpers/mapConfig'
import { t } from '@/i18n'

/** A network-independent schematic preserves route geometry and every coordinate. */
export function printMap(el: HTMLElement, config: MapConfig): void {
  const doc = el.ownerDocument
  const figure = el.appendChild(doc.win.createEl('figure'))
  figure.className = 'abele-print-map'
  figure.appendChild(doc.win.createEl('figcaption')).textContent = t('pdf.mapFallback')
  const points = [...config.points, ...config.lines.flatMap((line) => line.points)]
  if (!points.length && config.center) points.push(config.center)
  const svg = doc.win.createSvg('svg')
  svg.setAttribute('viewBox', '0 0 720 320')
  svg.setAttribute('width', '720')
  svg.setAttribute('height', '320')
  figure.append(svg)
  const minX = Math.min(...points.map((p) => p.lon))
  const minY = Math.min(...points.map((p) => p.lat))
  const spanX = Math.max(...points.map((p) => p.lon)) - minX || 1
  const spanY = Math.max(...points.map((p) => p.lat)) - minY || 1
  const xy = (p: { lat: number; lon: number }) =>
    `${20 + ((p.lon - minX) / spanX) * 680},${300 - ((p.lat - minY) / spanY) * 280}`
  for (const line of config.lines) {
    const path = doc.createElementNS(svg.namespaceURI, 'polyline')
    path.setAttribute('points', line.points.map(xy).join(' '))
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', 'currentColor')
    path.setAttribute('stroke-width', '2')
    svg.append(path)
  }
  const list = figure.appendChild(doc.win.createEl('ol'))
  points.forEach((point, i) => {
    const [x, y] = xy(point).split(',')
    const label = doc.createElementNS(svg.namespaceURI, 'text')
    label.setAttribute('x', x)
    label.setAttribute('y', y)
    label.setAttribute('fill', 'currentColor')
    label.textContent = String(i + 1)
    svg.append(label)
    list.appendChild(doc.win.createEl('li')).textContent =
      `${point.label ? point.label + ': ' : ''}${point.lat}, ${point.lon}`
  })
}
