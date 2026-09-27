import { MarkdownPostProcessorContext, MarkdownRenderChild } from 'obsidian'
import { echartsInit, EChartsType } from '@/bases/echarts'
import { parseYaml } from 'obsidian'
import Formula from 'fparser'

interface SeriesConfig {
  name?: string
  data?: Array<[string | number, number]> | number[]
  formula?: string
  type?: 'line' | 'bar' | 'scatter'
  smooth?: boolean
}

interface ChartConfig {
  type?: 'line' | 'bar' | 'scatter' | 'pie'
  height?: number
  title?: string
  x?: [number, number, number?] // [from, to, step?]
  xLabels?: string[]
  xAxis?: string
  yAxis?: string
  smooth?: boolean
  showDots?: boolean
  legend?: boolean
  precision?: number
  series: SeriesConfig[]
}

/**
 * Preprocess formula:
 * - ln → log
 * - Ternary `cond ? a : b` → `ifElse(cond, a, b)` (fparser built-in)
 * - `==` → `=` (fparser comparison operator)
 */
function preprocess(expr: string): string {
  let s = String(expr)
  s = s.replace(/\bln\b/g, 'log')
  // Ternary → ifElse (handle innermost first)
  while (/\?/.test(s)) {
    const replaced = s.replace(
      /([^?,]+?)\s*\?\s*([^?,]+?)\s*:\s*([^?,]+)/,
      (_, cond, then, els) => `ifElse(${cond.trim()}, ${then.trim()}, ${els.trim()})`
    )
    if (replaced === s) break
    s = replaced
  }
  s = s.replace(/==/g, '=')
  return s
}

function evaluateFormula(
  expr: string,
  from: number,
  to: number,
  step: number
): Array<[number, number]> {
  const processed = preprocess(expr)
  const formula = new Formula(processed)
  const points: Array<[number, number]> = []

  for (let x = from; x <= to; x += step) {
    try {
      const y = formula.evaluate({ x })
      if (typeof y === 'number' && isFinite(y)) {
        points.push([Math.round(x * 1e10) / 1e10, y])
      }
    } catch {
      // Skip undefined points
    }
  }

  return points
}

function buildEchartsOption(config: ChartConfig): Record<string, any> {
  const chartType = config.type || 'line'
  const showLegend = config.legend !== false && config.series.length > 1

  // Determine if we're using formulas (continuous x) or data points (category x)
  const hasFormula = config.series.some((s) => s.formula)
  const xRange = config.x || [0, 10]
  const step = xRange[2] ?? (xRange[1] - xRange[0]) / 200

  const seriesList: any[] = []

  for (const s of config.series) {
    const seriesType = s.type || chartType
    const name =
      s.name || (s.formula != null ? String(s.formula) : '') || `Series ${seriesList.length + 1}`

    if (s.formula) {
      const points = evaluateFormula(s.formula, xRange[0], xRange[1], step)
      seriesList.push({
        name,
        type: seriesType === 'pie' ? 'line' : seriesType,
        data: points,
        smooth: s.smooth ?? config.smooth ?? seriesType === 'line',
        showSymbol: config.showDots ?? false,
        emphasis: { disabled: true },
      })
    } else if (s.data) {
      if (chartType === 'pie') {
        // Pie data: [{name, value}]
        const pieData = Array.isArray(s.data)
          ? s.data.map((d) => {
              if (Array.isArray(d)) return { name: String(d[0]), value: d[1] }
              return { name: String(d), value: d }
            })
          : []
        seriesList.push({
          name,
          type: 'pie',
          data: pieData,
          radius: ['35%', '65%'],
          emphasis: { disabled: true },
        })
      } else {
        seriesList.push({
          name,
          type: seriesType,
          data: s.data,
          smooth: s.smooth ?? config.smooth ?? false,
          showSymbol: config.showDots ?? true,
          emphasis: { disabled: true },
        })
      }
    }
  }

  const precision = config.precision ?? 2
  const fmt = (v: number) => (typeof v === 'number' ? v.toFixed(precision) : v)

  if (chartType === 'pie') {
    return {
      animation: false,
      tooltip: { trigger: 'item', valueFormatter: fmt },
      legend: showLegend ? { bottom: 0, type: 'scroll' } : undefined,
      series: seriesList,
    }
  }

  const xAxisConfig: any = hasFormula
    ? { type: 'value', name: config.xAxis }
    : config.xLabels
      ? { type: 'category', data: config.xLabels, name: config.xAxis }
      : { type: 'category', name: config.xAxis }

  return {
    animation: false,
    tooltip: { trigger: 'axis', valueFormatter: fmt },
    legend: showLegend ? { bottom: 0, type: 'scroll' } : undefined,
    title: config.title ? { text: config.title, left: 'center', top: 0 } : undefined,
    grid: {
      left: 12,
      right: 12,
      top: config.title ? 36 : 12,
      bottom: showLegend ? 40 : 24,
      containLabel: true,
    },
    xAxis: xAxisConfig,
    yAxis: { type: 'value', name: config.yAxis },
    series: seriesList,
  }
}

/** Keeps the chart for exactly as long as the render that drew it. */
class ChartRenderChild extends MarkdownRenderChild {
  constructor(
    el: HTMLElement,
    private readonly dispose: () => void
  ) {
    super(el)
  }

  onunload(): void {
    this.dispose()
  }
}

export function registerChartCodeblock(
  registerFn: (
    language: string,
    handler: (source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => void
  ) => void
): void {
  registerFn('abele-chart', (source, el, ctx) => {
    let config: ChartConfig

    try {
      // Auto-quote formula values that contain YAML-breaking characters (: ? etc.)
      const safeSource = source.replace(
        /^(\s*formula:\s*)(.+)$/gm,
        (_match, prefix: string, value: string) => {
          const trimmed = value.trim()
          if (
            (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
            (trimmed.startsWith("'") && trimmed.endsWith("'"))
          ) {
            return prefix + trimmed
          }
          return `${prefix}"${trimmed.replace(/"/g, '\\"')}"`
        }
      )
      config = parseYaml(safeSource) as ChartConfig
    } catch (e) {
      el.createDiv({ cls: 'abele-chart-error', text: `YAML parse error: ${e}` })
      return
    }

    if (!config || !config.series?.length) {
      el.createDiv({ cls: 'abele-chart-error', text: 'No series defined' })
      return
    }

    const height = config.height || 300
    const container = el.createDiv({ cls: 'abele-chart-container' })
    container.style.height = `${height}px`

    let chart: EChartsType | null = null
    let gone = false

    const initChart = () => {
      if (chart || gone) return
      try {
        const option = buildEchartsOption(config)
        chart = echartsInit(container)
        chart.setOption(option, true)
      } catch (e) {
        container.remove()
        el.createDiv({
          cls: 'abele-chart-error',
          text: `Chart error: ${e instanceof Error ? e.message : e}`,
        })
        resizeObs.disconnect()
      }
    }

    // ResizeObserver fires when container gets dimensions (after DOM insert + layout)
    // and on subsequent resizes — single mechanism for both init and resize
    const resizeObs = new ResizeObserver((entries) => {
      if (!chart) {
        if (entries[0]?.contentRect.width > 0) initChart()
      } else {
        chart.resize()
      }
    })
    resizeObs.observe(container)

    // Owned by the render, as the map and the diagram are: a chat message, a script view or a
    // reading view closed around the block unloads it. Watching the parent for the block's own
    // removal missed every one of those — an ancestor went, the parent's children stayed — and
    // ECharts keeps each live chart in a registry of its own, so none of them was ever freed.
    ctx.addChild(
      new ChartRenderChild(container, () => {
        gone = true
        resizeObs.disconnect()
        chart?.dispose()
        chart = null
      })
    )
  })
}
