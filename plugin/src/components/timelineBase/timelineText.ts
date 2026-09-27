/**
 * The theme as the timeline's canvas paints with it — every colour and size read off the page,
 * so light, dark and any theme's accent and fonts come through — and the text of its labels,
 * measured once and kept.
 */
import type { KitColor } from '@/constants/colors'
import { formatSpan, type HistLang } from '@/bases/historyDates'
import type { TimelineItem } from '@/bases/timelineLayout'

export interface Palette {
  text: string
  muted: string
  faint: string
  background: string
  secondary: string
  border: string
  accent: string
  colors: Record<KitColor, string>
  font: string
  /** Pixel sizes of the theme's small and smaller interface text. */
  small: number
  smaller: number
  semibold: string
}

/** The theme's variables resolved through an element of the page. */
export function readPalette(probe: HTMLElement): Palette | null {
  const view = probe.ownerDocument.defaultView
  if (!view) return null
  const read = (name: string) => {
    probe.style.setProperty('color', `var(${name})`)
    return view.getComputedStyle(probe).color
  }
  const size = (name: string, fallback: number) => {
    probe.style.setProperty('font-size', `var(${name})`)
    return parseFloat(view.getComputedStyle(probe).fontSize) || fallback
  }
  const colors = {} as Record<KitColor, string>
  for (const c of ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const)
    colors[c] = read(`--color-${c}`)
  colors.grey = read('--text-muted')
  // The probe's own class sets the theme's semibold weight.
  const semibold = view.getComputedStyle(probe).fontWeight || '600'
  return {
    text: read('--text-normal'),
    muted: read('--text-muted'),
    faint: read('--text-faint'),
    background: read('--background-primary'),
    secondary: read('--background-secondary'),
    border: read('--background-modifier-border'),
    accent: read('--interactive-accent'),
    colors,
    font: view.getComputedStyle(probe).fontFamily,
    small: size('--font-ui-small', 13),
    smaller: size('--font-ui-smaller', 12),
    semibold,
  }
}

/** `rgb(r, g, b)` as the same colour at `alpha`. */
export function withAlpha(color: string, alpha: number): string {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(color)
  return m ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})` : color
}

/** A bar's label: its name and its dates as the note wrote them. */
const dateCache = new WeakMap<TimelineItem, string>()
export function datesOf(item: TimelineItem, lang: HistLang): string {
  let d = dateCache.get(item)
  if (d === undefined) {
    d = formatSpan(item.start, item.end, lang)
    dateCache.set(item, d)
  }
  return d
}

export const fontOf = (p: Palette, bold: boolean, size = p.smaller) =>
  `${bold ? p.semibold : 'normal'} ${size}px ${p.font}`

const widthCache = new Map<string, number>()
/** Text widths, kept: labels are measured for every packing and every frame. */
export function measure(ctx: CanvasRenderingContext2D, text: string, font: string): number {
  const key = `${font}|${text}`
  let w = widthCache.get(key)
  if (w === undefined) {
    ctx.font = font
    w = ctx.measureText(text).width
    if (widthCache.size > 20_000) widthCache.clear()
    widthCache.set(key, w)
  }
  return w
}

/** How wide an item's label is drawn: the round picture, the name, the dates. */
export function labelWidth(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  item: TimelineItem,
  lang: HistLang,
  covers: boolean,
  barH: number
): number {
  const name = measure(ctx, item.title, fontOf(p, true))
  const dates = measure(ctx, datesOf(item, lang), fontOf(p, false))
  return name + 5 + dates + (covers && item.cover ? barH + 6 : 0)
}

export function ellipsis(ctx: CanvasRenderingContext2D, text: string, room: number): string {
  if (measure(ctx, text, ctx.font) <= room) return text
  let s = text
  while (s.length > 1 && measure(ctx, s + '…', ctx.font) > room) s = s.slice(0, -1)
  return s + '…'
}
