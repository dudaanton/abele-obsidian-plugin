import { BasesView, BasesPropertyId, NullValue, QueryController } from 'obsidian'
import { echartsInit, EChartsType } from './echarts'
import { GlobalStore } from '@/stores/GlobalStore'
import { watch } from 'vue'
import dayjs from 'dayjs'

export const CHART_VIEW_ID = 'abele-chart'

type ChartType = 'line' | 'scatter' | 'bar'

function extractNumber(val: any): number | null {
  if (val == null || val instanceof NullValue) return null
  const n = parseFloat(val.toString())
  return isNaN(n) ? null : n
}

function extractDateString(val: any): string | null {
  if (val == null || val instanceof NullValue) return null
  const s = val.toString()
  if (!s) return null
  const d = dayjs(s)
  return d.isValid() ? d.format('YYYY-MM-DD') : null
}

function getDateFormat(dates: string[]): string {
  if (dates.length < 2) return 'MMM D'
  const first = dayjs(dates[0])
  const last = dayjs(dates[dates.length - 1])
  if (!first.isValid() || !last.isValid()) return 'MMM D'
  return first.year() !== last.year() ? 'MMM D, YYYY' : 'MMM D'
}

function formatDateLabel(d: string, fmt: string): string {
  const parsed = dayjs(d)
  return parsed.isValid() ? parsed.format(fmt) : d
}

export class ChartView extends BasesView {
  type = CHART_VIEW_ID
  private containerEl: HTMLElement
  private chart: EChartsType | null = null
  private stopThemeWatch: (() => void) | null = null

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller)
    this.containerEl = containerEl

    this.stopThemeWatch = watch(
      () => GlobalStore.getInstance().themeVersion.value,
      () => {
        this.chart?.dispose()
        this.chart = null
        this.render()
      }
    )
  }

  onDataUpdated(): void {
    this.render()
  }

  onunload(): void {
    this.chart?.dispose()
    this.chart = null
    this.stopThemeWatch?.()
    this.stopThemeWatch = null
  }

  private render(): void {
    const chartType = ((this.config.get('chartType') as string) || 'line') as ChartType
    const logScale = !!this.config.get('logScale')
    const dualAxis = !!this.config.get('dualAxis')
    const showDots = !!this.config.get('showDots')
    const timeAxis = !!this.config.get('timeAxis')
    const dateProp = this.config.getAsPropertyId('dateProperty')
    const groupProp = this.config.getAsPropertyId('groupProperty')

    const allOrder = this.config.getOrder()
    const excludeSet = new Set<BasesPropertyId>()
    if (dateProp) excludeSet.add(dateProp)
    if (groupProp) excludeSet.add(groupProp)
    const valueProps = allOrder.filter((p) => !excludeSet.has(p))

    if (!valueProps.length) {
      this.showEmpty('Add properties to display on chart')
      return
    }

    const entries = this.data.data
    if (!entries.length) {
      this.showEmpty('No data')
      return
    }

    interface DataPoint {
      date: string
      group: string
      values: Map<BasesPropertyId, number>
    }

    const points: DataPoint[] = []

    for (const entry of entries) {
      let dateStr: string | null = null
      if (dateProp) {
        dateStr = extractDateString(entry.getValue(dateProp))
      }
      if (!dateStr) {
        dateStr = entry.file.basename
      }
      if (!dateStr) continue

      let group = ''
      if (groupProp) {
        const gVal = entry.getValue(groupProp)
        if (gVal && !(gVal instanceof NullValue)) {
          group = gVal.toString()
        }
      }

      const values = new Map<BasesPropertyId, number>()
      for (const prop of valueProps) {
        const n = extractNumber(entry.getValue(prop))
        if (n !== null) {
          values.set(prop, n)
        }
      }

      if (values.size > 0) {
        points.push({ date: dateStr, group, values })
      }
    }

    if (!points.length) {
      this.showEmpty('No numeric data found')
      return
    }

    if (chartType === 'scatter') {
      this.renderScatter(points, valueProps, groupProp, logScale, timeAxis)
    } else {
      this.renderCategorySeries(
        points,
        valueProps,
        groupProp,
        chartType,
        logScale,
        dualAxis,
        showDots,
        timeAxis
      )
    }
  }

  private renderCategorySeries(
    points: Array<{ date: string; group: string; values: Map<BasesPropertyId, number> }>,
    valueProps: BasesPropertyId[],
    groupProp: BasesPropertyId | null,
    chartType: 'line' | 'bar',
    logScale: boolean,
    dualAxis: boolean,
    showDots: boolean,
    timeAxis: boolean
  ): void {
    const allDates = [...new Set(points.map((p) => p.date))].sort()
    const hasGroups = groupProp && new Set(points.map((p) => p.group)).size > 1
    const allGroups = hasGroups ? [...new Set(points.map((p) => p.group))].sort() : ['']

    interface Series {
      name: string
      data: (number | null)[] | [string, number][]
    }

    const seriesList: Series[] = []
    const dateIndex = new Map(allDates.map((d, i) => [d, i]))

    for (const group of allGroups) {
      for (const prop of valueProps) {
        const propName = this.config.getDisplayName(prop)
        const name = hasGroups ? `${group} — ${propName}` : propName

        if (timeAxis) {
          const data: [string, number][] = []
          for (const point of points) {
            if (point.group !== group) continue
            const val = point.values.get(prop)
            if (val !== undefined) {
              data.push([point.date, val])
            }
          }
          if (data.length) {
            seriesList.push({ name, data })
          }
        } else {
          const data: (number | null)[] = new Array(allDates.length).fill(null)
          for (const point of points) {
            if (point.group !== group) continue
            const val = point.values.get(prop)
            if (val !== undefined) {
              const idx = dateIndex.get(point.date)!
              if (chartType === 'bar' && data[idx] !== null) {
                data[idx] = data[idx]! + val
              } else {
                data[idx] = val
              }
            }
          }
          if (data.some((v) => v !== null)) {
            seriesList.push({ name, data })
          }
        }
      }
    }

    if (!seriesList.length) {
      this.showEmpty('No data to chart')
      return
    }

    const dateFmt = getDateFormat(allDates)
    const xLabels = allDates.map((d) => formatDateLabel(d, dateFmt))
    this.ensureChart()

    this.chart!.setOption(
      {
        tooltip: { trigger: 'axis' },
        legend: {
          data: seriesList.map((s) => s.name),
          bottom: 0,
          type: 'scroll',
        },
        grid: {
          left: 12,
          right: dualAxis && seriesList.length > 1 ? 12 : 12,
          top: 12,
          bottom: 40,
          containLabel: true,
        },
        xAxis: timeAxis
          ? {
              type: 'time',
              axisLabel: { hideOverlap: true },
            }
          : {
              type: 'category',
              data: xLabels,
              axisLabel: {
                interval: Math.max(Math.floor(xLabels.length / 6) - 1, 0),
                hideOverlap: true,
                ...(xLabels.length > 8 ? { rotate: 45 } : {}),
              },
            },
        yAxis:
          dualAxis && seriesList.length > 1
            ? seriesList.map((_, i) => ({
                type: logScale ? 'log' : 'value',
                scale: true,
                position: i % 2 === 0 ? 'left' : 'right',
                axisLine: { show: true },
                axisLabel: { show: i < 2 },
                splitLine: { show: i === 0 },
              }))
            : { type: logScale ? 'log' : 'value' },
        series: seriesList.map((s, i) => ({
          name: s.name,
          type: chartType,
          data: s.data,
          ...(dualAxis && seriesList.length > 1 ? { yAxisIndex: i } : {}),
          ...(chartType === 'line'
            ? {
                connectNulls: true,
                symbol: showDots ? 'circle' : 'none',
                symbolSize: showDots ? 6 : 0,
              }
            : {}),
          emphasis: { disabled: true },
        })),
      },
      true
    )
  }

  private renderScatter(
    points: Array<{ date: string; group: string; values: Map<BasesPropertyId, number> }>,
    valueProps: BasesPropertyId[],
    groupProp: BasesPropertyId | null,
    logScale: boolean,
    timeAxis: boolean
  ): void {
    const allDates = [...new Set(points.map((p) => p.date))].sort()
    const hasGroups = groupProp && new Set(points.map((p) => p.group)).size > 1
    const allGroups = hasGroups ? [...new Set(points.map((p) => p.group))].sort() : ['']

    interface ScatterSeries {
      name: string
      data: [number, number][] | [string, number][]
    }

    const seriesList: ScatterSeries[] = []

    for (const group of allGroups) {
      for (const prop of valueProps) {
        const propName = this.config.getDisplayName(prop)
        const name = hasGroups ? `${group} — ${propName}` : propName

        if (timeAxis) {
          const data: [string, number][] = []
          for (const point of points) {
            if (point.group !== group) continue
            const val = point.values.get(prop)
            if (val !== undefined) {
              data.push([point.date, val])
            }
          }
          if (data.length) {
            seriesList.push({ name, data })
          }
        } else {
          const data: [number, number][] = []
          for (const point of points) {
            if (point.group !== group) continue
            const val = point.values.get(prop)
            if (val !== undefined) {
              const xIdx = allDates.indexOf(point.date)
              data.push([xIdx, val])
            }
          }
          if (data.length) {
            seriesList.push({ name, data })
          }
        }
      }
    }

    if (!seriesList.length) {
      this.showEmpty('No data to chart')
      return
    }

    const dateFmt = getDateFormat(allDates)
    const xLabels = allDates.map((d) => formatDateLabel(d, dateFmt))
    this.ensureChart()

    this.chart!.setOption(
      {
        tooltip: {
          trigger: 'item',
          formatter: (params: any) => {
            if (timeAxis) {
              const label = dayjs(params.data[0]).format(dateFmt)
              return `${params.marker} ${params.seriesName}<br/>${label}: ${params.data[1]}`
            }
            const xIdx = params.data[0]
            const label = xLabels[xIdx] ?? xIdx
            return `${params.marker} ${params.seriesName}<br/>${label}: ${params.data[1]}`
          },
        },
        legend: {
          data: seriesList.map((s) => s.name),
          bottom: 0,
          type: 'scroll',
        },
        grid: {
          left: 12,
          right: 12,
          top: 12,
          bottom: 40,
          containLabel: true,
        },
        xAxis: timeAxis
          ? {
              type: 'time',
              axisLabel: { hideOverlap: true },
            }
          : {
              type: 'category',
              data: xLabels,
              axisLabel: {
                interval: Math.max(Math.floor(xLabels.length / 6) - 1, 0),
                hideOverlap: true,
                ...(xLabels.length > 8 ? { rotate: 45 } : {}),
              },
            },
        yAxis: { type: logScale ? 'log' : 'value' },
        series: seriesList.map((s) => ({
          name: s.name,
          type: 'scatter' as const,
          data: s.data,
          symbolSize: 8,
          emphasis: { disabled: true },
        })),
      },
      true
    )
  }

  private showEmpty(text: string): void {
    this.containerEl.empty()
    this.containerEl.createEl('div', { text, cls: 'abele-bases-chart__empty' })
  }

  private ensureChart(): void {
    const height = (this.config.get('chartHeight') as number) || 500

    this.containerEl.empty()
    const chartDiv = this.containerEl.createDiv({ cls: 'abele-bases-echart' })
    chartDiv.style.width = '100%'
    chartDiv.style.height = `${height}px`

    this.chart?.dispose()
    this.chart = echartsInit(chartDiv)
  }
}
