import { BasesView, BasesPropertyId, NullValue, QueryController, parsePropertyId } from 'obsidian'
import { echartsInit, EChartsType } from './echarts'
import dayjs from 'dayjs'

export const LINE_CHART_VIEW_ID = 'abele-line-chart'

function extractNumber(val: any): number | null {
  if (val == null || val instanceof NullValue) return null
  const n = parseFloat(val.toString())
  return isNaN(n) ? null : n
}

function extractDateString(val: any): string | null {
  if (val == null || val instanceof NullValue) return null
  const s = val.toString()
  if (!s) return null
  // Try parsing as date to validate
  const d = dayjs(s)
  return d.isValid() ? d.format('YYYY-MM-DD') : null
}

export class LineChartView extends BasesView {
  type = LINE_CHART_VIEW_ID
  private containerEl: HTMLElement
  private chart: EChartsType | null = null

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller)
    this.containerEl = containerEl
  }

  onDataUpdated(): void {
    this.render()
  }

  onunload(): void {
    this.chart?.dispose()
    this.chart = null
  }

  private render(): void {
    const dateProp = this.config.getAsPropertyId('dateProperty')
    const groupProp = this.config.getAsPropertyId('groupProperty')

    // Value properties = all ordered properties minus date and group
    const allOrder = this.config.getOrder()
    const excludeSet = new Set<BasesPropertyId>()
    if (dateProp) excludeSet.add(dateProp)
    if (groupProp) excludeSet.add(groupProp)
    const valueProps = allOrder.filter((p) => !excludeSet.has(p))

    if (!valueProps.length) {
      this.containerEl.empty()
      this.containerEl.createEl('div', {
        text: 'Add properties to display as chart lines',
        cls: 'abele-bases-chart__empty',
      })
      return
    }

    const entries = this.data.data

    if (!entries.length) {
      this.containerEl.empty()
      this.containerEl.createEl('div', { text: 'No data', cls: 'abele-bases-chart__empty' })
      return
    }

    // Collect data points: { date, group?, values: { propId: number } }
    interface DataPoint {
      date: string
      group: string
      values: Map<BasesPropertyId, number>
    }

    const points: DataPoint[] = []

    for (const entry of entries) {
      // Extract date
      let dateStr: string | null = null
      if (dateProp) {
        dateStr = extractDateString(entry.getValue(dateProp))
      }
      if (!dateStr) {
        // Fall back to file name (could be a date-based filename)
        dateStr = entry.file.basename
      }
      if (!dateStr) continue

      // Extract group
      let group = ''
      if (groupProp) {
        const gVal = entry.getValue(groupProp)
        if (gVal && !(gVal instanceof NullValue)) {
          group = gVal.toString()
        }
      }

      // Extract values
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
      this.containerEl.empty()
      this.containerEl.createEl('div', {
        text: 'No numeric data found',
        cls: 'abele-bases-chart__empty',
      })
      return
    }

    // Collect all unique dates, sorted
    const allDates = [...new Set(points.map((p) => p.date))].sort()

    // Build series
    // If groupProp is set: series = group × valueProp combinations
    // If no groupProp: series = one per valueProp
    const hasGroups = groupProp && new Set(points.map((p) => p.group)).size > 1
    const allGroups = hasGroups ? [...new Set(points.map((p) => p.group))].sort() : ['']

    interface Series {
      name: string
      data: (number | null)[]
    }

    const seriesList: Series[] = []
    const dateIndex = new Map(allDates.map((d, i) => [d, i]))

    for (const group of allGroups) {
      for (const prop of valueProps) {
        const propName = this.config.getDisplayName(prop)
        const name = hasGroups ? `${group} — ${propName}` : propName
        const data: (number | null)[] = new Array(allDates.length).fill(null)

        for (const point of points) {
          if (point.group !== group) continue
          const val = point.values.get(prop)
          if (val !== undefined) {
            const idx = dateIndex.get(point.date)!
            data[idx] = val
          }
        }

        // Only add series if it has at least one value
        if (data.some((v) => v !== null)) {
          seriesList.push({ name, data })
        }
      }
    }

    if (!seriesList.length) {
      this.containerEl.empty()
      this.containerEl.createEl('div', {
        text: 'No data to chart',
        cls: 'abele-bases-chart__empty',
      })
      return
    }

    // Render chart
    this.containerEl.empty()
    const chartDiv = this.containerEl.createDiv({ cls: 'abele-bases-echart' })
    chartDiv.style.width = '100%'
    chartDiv.style.height = '320px'

    this.chart?.dispose()
    this.chart = echartsInit(chartDiv)

    const xLabels = allDates.map((d) => {
      const parsed = dayjs(d)
      return parsed.isValid() ? parsed.format('MMM D') : d
    })

    this.chart.setOption({
      tooltip: {
        trigger: 'axis',
      },
      legend: {
        data: seriesList.map((s) => s.name),
        bottom: 0,
        type: 'scroll',
      },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
        },
        {
          type: 'inside',
          yAxisIndex: 0,
        },
      ],
      toolbox: {
        right: 12,
        feature: {
          dataZoom: {
            yAxisIndex: 'none',
          },
        },
      },
      grid: {
        left: 12,
        right: 12,
        top: 32,
        bottom: 40,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: {
          interval: Math.max(Math.floor(xLabels.length / 6) - 1, 0),
        },
      },
      yAxis: {
        type: 'value',
      },
      series: seriesList.map((s) => ({
        name: s.name,
        type: 'line',
        data: s.data,
        connectNulls: true,
        emphasis: { disabled: true },
      })),
    })

    const observer = new ResizeObserver(() => this.chart?.resize())
    observer.observe(chartDiv)
    this.register(() => observer.disconnect())
  }
}
