import type { Ref } from 'vue'
import type { Dayjs } from 'dayjs'
import { getThemeColors, type EChartsType } from '@/bases/echarts'
import { escapeHtml } from '@/helpers/escapeHtml'
import { formatAmount } from '@/helpers/moneyFormat'
import { DATE_FORMAT } from '@/constants/dates'
import type { PieItem } from './useFinancePeriodSummary'

interface FinanceChartOptions {
  pieData: Ref<PieItem[]>
  calendarData: Ref<Map<string, { expense: number; income: number }>>
  periodStart: Ref<Dayjs>
  periodEnd: Ref<Dayjs>
  weekStartsOnMonday: Ref<boolean>
  networthData: Ref<{ dates: string[]; series: { name: string; data: number[] }[] }>
  networthLegendSelected: Ref<Record<string, boolean>>
  openFile: (path: string) => void
}

export function useFinanceCharts(options: FinanceChartOptions) {
  const {
    pieData,
    calendarData,
    periodStart,
    periodEnd,
    weekStartsOnMonday,
    networthData,
    networthLegendSelected,
    openFile,
  } = options

  function createPieChart(pieChart: EChartsType) {
    pieChart.on('click', (params: any) => {
      const item = pieData.value[params.dataIndex]
      if (item?.path) openFile(item.path)
    })
  }

  function renderPieChart(pieChart: EChartsType) {
    const colors = getThemeColors(pieChart.getDom?.())
    const data = pieData.value

    if (!data.length) {
      pieChart.clear()
      return
    }

    pieChart.setOption(
      {
        animation: false,
        tooltip: {
          trigger: 'item',
          enterable: false,
          confine: true,
          formatter: (p: any) =>
            `${p.marker} ${escapeHtml(p.name)}: ${escapeHtml(formatAmount(p.value))} (${escapeHtml(p.percent)}%)`,
        },
        series: [
          {
            type: 'pie',
            radius: ['32%', '52%'],
            center: ['50%', '50%'],
            itemStyle: {
              borderWidth: 2,
              borderColor: getComputedStyle(document.body)
                .getPropertyValue('--background-primary')
                .trim(),
            },
            emphasis: { disabled: true },
            // The labels stand against the chart's edges rather than at the end of a fixed-length
            // line, so a category's name has all the room beside the ring. Left free, a label
            // was cut wherever the line happened to end — to "Ho..." at a sidebar's width.
            label: {
              color: colors.text,
              formatter: '{b}',
              alignTo: 'edge',
              edgeDistance: 0,
            },
            labelLine: { length: 8, length2: 0 },
            data,
          },
        ],
      },
      true
    )
  }

  function renderCalendarChart(calendarChart: EChartsType) {
    const colors = getThemeColors(calendarChart.getDom?.())
    const rangeStart = periodStart.value.format(DATE_FORMAT)
    const rangeEnd = periodEnd.value.format(DATE_FORMAT)
    const dayTotals = calendarData.value

    const expenseData: Array<[string, number]> = []
    let d = periodStart.value
    while (d.isBefore(periodEnd.value) || d.isSame(periodEnd.value, 'day')) {
      const dateStr = d.format(DATE_FORMAT)
      const data = dayTotals.get(dateStr)
      expenseData.push([dateStr, data?.expense || 0])
      d = d.add(1, 'day')
    }

    const maxExpense = Math.max(...expenseData.map((e) => e[1]), 1)
    const bgPrimary = colors.bgPrimary
    const emptyColor = colors.bgSecondary

    const fmtShort = (n: number): string => {
      if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k'
      return n.toFixed(0)
    }

    calendarChart.setOption(
      {
        animation: false,
        tooltip: {
          formatter: (params: any) => {
            const dateStr = params.data[0]
            const data = dayTotals.get(dateStr)
            if (!data || (data.expense === 0 && data.income === 0))
              return `${escapeHtml(dateStr)}<br/>No transactions`
            let html = `<b>${escapeHtml(dateStr)}</b>`
            if (data.income > 0)
              html += `<br/><span style="color:${colors.income}">+${formatAmount(data.income)}</span>`
            if (data.expense > 0)
              html += `<br/><span style="color:${colors.expense}">-${formatAmount(data.expense)}</span>`
            return html
          },
        },
        visualMap: {
          show: false,
          min: 0,
          max: maxExpense,
          inRange: {
            // Interpolate resolved host colours; appending hex alpha fails for rgb/hsl themes.
            color: [emptyColor, colors.expense],
          },
        },
        calendar: {
          top: 8,
          left: 30,
          right: 8,
          bottom: 8,
          range: [rangeStart, rangeEnd],
          cellSize: ['auto', 28],
          dayLabel: {
            firstDay: weekStartsOnMonday.value ? 1 : 0,
            nameMap: 'en',
            color: colors.textFaint,
          },
          monthLabel: { show: false },
          yearLabel: { show: false },
          splitLine: { lineStyle: { color: 'transparent' } },
          itemStyle: { borderWidth: 2, borderColor: bgPrimary, borderRadius: 4 },
        },
        series: [
          {
            type: 'heatmap',
            coordinateSystem: 'calendar',
            data: expenseData,
            label: {
              show: true,
              color: colors.text,
              formatter: (params: any) => {
                const data = dayTotals.get(params.data[0])
                if (!data) return ''
                const parts: string[] = []
                if (data.income > 0) parts.push(`+${fmtShort(data.income)}`)
                if (data.expense > 0) parts.push(`-${fmtShort(data.expense)}`)
                return parts.join('\n')
              },
              fontSize: 9,
              lineHeight: 11,
            },
          },
        ],
      },
      true
    )
  }

  function createNetworthChart(networthChart: EChartsType) {
    networthChart.on('legendselectchanged', (params: any) => {
      networthLegendSelected.value = { ...params.selected }
    })
  }

  function renderNetworthChart(networthChart: EChartsType) {
    const { dates, series } = networthData.value

    if (!dates.length || !series.length) {
      networthChart.clear()
      return
    }

    networthChart.setOption(
      {
        animation: false,
        tooltip: {
          trigger: 'axis',
          valueFormatter: (v: number) => formatAmount(v),
        },
        legend: {
          data: series.map((s) => s.name),
          selected: Object.keys(networthLegendSelected.value).length
            ? networthLegendSelected.value
            : undefined,
          bottom: 0,
          type: 'scroll',
        },
        grid: {
          left: 12,
          right: 12,
          top: 12,
          bottom: series.length > 1 ? 40 : 24,
          containLabel: true,
        },
        xAxis: {
          type: 'category',
          data: dates,
          boundaryGap: false,
          axisLabel: {
            interval: Math.max(Math.floor(dates.length / 6) - 1, 0),
            hideOverlap: true,
            ...(dates.length > 8 ? { rotate: 45 } : {}),
          },
        },
        yAxis: { type: 'value' },
        series: series.map((s) => ({
          name: s.name,
          type: 'line',
          data: s.data,
          emphasis: { disabled: true },
        })),
      },
      true
    )
  }

  return {
    createPieChart,
    renderPieChart,
    renderCalendarChart,
    createNetworthChart,
    renderNetworthChart,
  }
}
