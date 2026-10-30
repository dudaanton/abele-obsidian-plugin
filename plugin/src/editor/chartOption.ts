import Formula from 'fparser'
import { t } from '@/i18n'

const MAX_FORMULA_SAMPLES = 10000

/** What an `abele-chart` block says, and the ECharts option it is drawn with. */

export interface SeriesConfig {
  name?: string
  data?: Array<[string | number, number]> | number[]
  formula?: string
  type?: 'line' | 'bar' | 'scatter'
  smooth?: boolean
}

export interface ChartConfig {
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
  step: number,
  budget: { remaining: number }
): Array<[number, number]> {
  const processed = preprocess(expr)
  const formula = new Formula(processed)
  const points: Array<[number, number]> = []

  for (let x = from; step > 0 ? x <= to : x >= to; x += step) {
    // Count attempts, including undefined points and steps too small to advance a float.
    // Share the budget across series so adding formulas cannot multiply the work limit.
    if (budget.remaining-- <= 0)
      throw new Error(t('chart.sampleLimit', { limit: MAX_FORMULA_SAMPLES }))
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

export function buildEchartsOption(config: ChartConfig): Record<string, any> {
  const chartType = config.type || 'line'
  const showLegend = config.legend !== false && config.series.length > 1

  // Determine if we're using formulas (continuous x) or data points (category x)
  const hasFormula = config.series.some((s) => s.formula)
  const xRange = config.x || [0, 10]
  const step = xRange[2] ?? (xRange[1] - xRange[0]) / 200
  if (
    hasFormula &&
    (!Array.isArray(xRange) ||
      !Number.isFinite(xRange[0]) ||
      !Number.isFinite(xRange[1]) ||
      !Number.isFinite(step) ||
      step === 0 ||
      (xRange[0] < xRange[1] && step < 0) ||
      (xRange[0] > xRange[1] && step > 0))
  ) {
    throw new Error(t('chart.invalidRange'))
  }

  const seriesList: any[] = []
  const budget = { remaining: MAX_FORMULA_SAMPLES }

  for (const s of config.series) {
    const seriesType = s.type || chartType
    const name =
      s.name || (s.formula != null ? String(s.formula) : '') || `Series ${seriesList.length + 1}`

    if (s.formula) {
      const points = evaluateFormula(s.formula, xRange[0], xRange[1], step, budget)
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
