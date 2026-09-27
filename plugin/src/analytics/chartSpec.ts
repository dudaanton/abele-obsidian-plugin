/**
 * An `abele-chart` code block for an analysis — the chart format every note and the chat already
 * render, so an agent can put the block in its answer as it is. Lines over periods, one per group
 * (plus the rolling mean and the forecast with its 80% range for a single one), or bars of the
 * group totals when there are no periods.
 */
import { stringifyYaml } from 'obsidian'

export interface ChartLine {
  name: string
  /** Period key → value. */
  points: Map<string, number | null>
  type?: 'line' | 'bar'
}

const MAX_LINES = 8

export function lineChart(
  title: string,
  labels: string[],
  lines: ChartLine[],
  yAxis?: string
): string {
  const shown = lines.slice(0, MAX_LINES)
  const config = {
    type: 'line',
    title,
    ...(yAxis ? { yAxis } : {}),
    showDots: labels.length <= 40,
    legend: shown.length > 1,
    xLabels: labels,
    series: shown.map((l) => ({
      name: l.name,
      ...(l.type ? { type: l.type } : {}),
      data: labels.map((k) => {
        const v = l.points.get(k)
        return v === undefined ? null : v
      }),
    })),
  }
  return block(config)
}

export function barChart(
  title: string,
  bars: { label: string; value: number }[],
  yAxis?: string
): string {
  const config = {
    type: 'bar',
    title,
    ...(yAxis ? { yAxis } : {}),
    legend: false,
    xLabels: bars.map((b) => b.label),
    series: [{ name: title, data: bars.map((b) => b.value) }],
  }
  return block(config)
}

function block(config: unknown): string {
  return '```abele-chart\n' + stringifyYaml(config).trimEnd() + '\n```'
}
