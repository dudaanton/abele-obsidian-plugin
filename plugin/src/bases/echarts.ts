import { use, init, registerTheme } from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import { LineChart, BarChart, PieChart, HeatmapChart, ScatterChart } from 'echarts/charts'
import {
  CalendarComponent,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers'
import { isPrintMode } from '@/markdown/printMode'

let registered = false
function ensureRegistered() {
  if (registered) return
  use([
    LineChart,
    BarChart,
    PieChart,
    HeatmapChart,
    ScatterChart,
    CalendarComponent,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    TitleComponent,
    VisualMapComponent,
    CanvasRenderer,
    SVGRenderer,
  ])
  registered = true
}

const THEME_NAME = 'obsidian-abele'

function themeReader(doc: Document) {
  const style = (doc.defaultView ?? window).getComputedStyle(doc.body)
  return (name: string) => style.getPropertyValue(name).trim()
}

/** The colours series are drawn in, in order: the theme's accent first, then its named ones. */
export function themePalette(doc: Document): string[] {
  const css = themeReader(doc)
  return [
    css('--interactive-accent'),
    css('--text-success') || css('--color-green'),
    css('--text-error') || css('--color-red'),
    ...['orange', 'purple', 'cyan', 'pink', 'blue'].map((name) => css(`--color-${name}`)),
  ]
}

function buildTheme(doc: Document): Record<string, any> {
  const css = themeReader(doc)
  const textColor = css('--text-normal')
  const textMuted = css('--text-muted')
  const textFaint = css('--text-faint')
  const border = css('--background-modifier-border')
  const bgSecondary = css('--background-secondary')
  const accent = css('--interactive-accent')
  const success = css('--text-success') || css('--color-green')
  const error = css('--text-error') || css('--color-red')

  return {
    // Palette
    color: [
      accent,
      success,
      error,
      ...['orange', 'purple', 'cyan', 'pink', 'blue'].map((name) => css(`--color-${name}`)),
    ],
    backgroundColor: 'transparent',

    // Global text
    textStyle: {
      color: textColor,
      fontFamily: css('--font-interface') || 'inherit',
    },

    // Title
    title: {
      textStyle: { color: textColor },
      subtextStyle: { color: textMuted },
    },

    // Legend
    legend: {
      textStyle: { color: textMuted },
    },

    // Tooltip
    tooltip: {
      backgroundColor: bgSecondary,
      borderColor: border,
      textStyle: { color: textColor },
      extraCssText: `border-radius: ${css('--radius-s')}; box-shadow: ${css('--shadow-s')};`,
    },

    // Category axis (x when horizontal, y when vertical)
    categoryAxis: {
      axisLine: { show: true, lineStyle: { color: border } },
      axisTick: { show: false },
      axisLabel: { color: textFaint },
      splitLine: { show: false },
    },

    // Value axis
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textFaint },
      splitLine: { show: true, lineStyle: { color: border, type: 'dashed', opacity: 0.6 } },
    },

    // Line series defaults
    line: {
      smooth: true,
      symbol: 'none',
      lineStyle: { width: 2 },
    },

    // Bar series defaults
    bar: {
      itemStyle: { borderRadius: [4, 4, 0, 0] },
    },

    // Calendar component
    calendar: {
      itemStyle: {
        color: 'transparent',
        borderColor: border,
        borderWidth: 1,
      },
      dayLabel: { color: textFaint },
      monthLabel: { color: textMuted },
      yearLabel: { color: textMuted },
      splitLine: { lineStyle: { color: border } },
    },

    // Heatmap series — label color readable on both light/dark cells
    heatmap: {
      itemStyle: {
        borderColor: 'transparent',
        borderWidth: 2,
        borderRadius: 3,
      },
      label: {
        color: textColor,
      },
    },

    // VisualMap
    visualMap: {
      textStyle: { color: textFaint },
    },
  }
}

/** Initialize an ECharts instance with the Obsidian theme applied */
export function echartsInit(el: HTMLElement): EChartsType {
  ensureRegistered()
  if (isPrintMode(el)) {
    const chart = init(
      el,
      { ...buildTheme(el.ownerDocument), animation: false },
      {
        renderer: 'svg',
        width: Math.min(el.clientWidth || 720, 720),
        height: el.clientHeight || Number.parseFloat(el.style.height) || 300,
      }
    )
    chart.on('finished', () => {
      const svg = el.querySelector('svg')
      if (svg)
        svg.setAttribute(
          'viewBox',
          `0 0 ${svg.getAttribute('width')} ${svg.getAttribute('height')}`
        )
      el.classList.add('abele-print-chart')
    })
    return chart
  }
  registerTheme(THEME_NAME, buildTheme(el.ownerDocument))
  return init(el, THEME_NAME)
}

/** SVG rendering needs neither a visible canvas nor an animation frame in the PDF window. */
export function printChart(el: HTMLElement, option: Record<string, unknown>, height: number): void {
  printChartWith(el, height, (chart) => chart.setOption({ ...option, animation: false }))
}

export function printChartWith(
  el: HTMLElement,
  height: number,
  render: (chart: EChartsType) => void
): void {
  ensureRegistered()
  const width = Math.min(el.clientWidth || 720, 720)
  const chart = init(
    el,
    { ...buildTheme(el.ownerDocument), animation: false },
    {
      renderer: 'svg',
      width,
      height,
    }
  )
  let snapshot: SVGSVGElement
  try {
    render(chart)
    const svg = el.querySelector('svg')
    if (!svg) throw new Error('Chart produced no SVG')
    // Clone DOM instead of parsing serialized markup: CSS font families can contain quotes.
    snapshot = svg.cloneNode(true) as SVGSVGElement
    snapshot.setAttribute('viewBox', `0 0 ${width} ${height}`)
  } finally {
    chart.dispose()
  }
  el.classList.add('abele-print-chart')
  el.replaceChildren(snapshot)
}

/** Get current resolved Obsidian CSS color values for use in chart options */
export function getThemeColors(el?: HTMLElement) {
  const css = themeReader(el?.ownerDocument ?? document)
  return {
    income: css('--text-success') || css('--color-green'),
    expense: css('--text-error') || css('--color-red'),
    accent: css('--interactive-accent'),
    text: css('--text-normal'),
    textMuted: css('--text-muted'),
    textFaint: css('--text-faint'),
    border: css('--background-modifier-border'),
    bgPrimary: css('--background-primary'),
    bgSecondary: css('--background-secondary'),
  }
}

export type { EChartsType }
