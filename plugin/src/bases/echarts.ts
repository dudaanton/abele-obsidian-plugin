import { use, init, registerTheme } from 'echarts/core'
import type { EChartsType } from 'echarts/core'
import { LineChart, BarChart, PieChart, HeatmapChart, ScatterChart } from 'echarts/charts'
import {
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  ToolboxComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

use([
  LineChart,
  BarChart,
  PieChart,
  HeatmapChart,
  ScatterChart,
  CalendarComponent,
  DataZoomComponent,
  GridComponent,
  ToolboxComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  VisualMapComponent,
  CanvasRenderer,
])

const THEME_NAME = 'obsidian-abele'

function css(varName: string): string {
  return getComputedStyle(document.body).getPropertyValue(varName).trim()
}

function buildTheme(): Record<string, any> {
  const textColor = css('--text-normal')
  const textMuted = css('--text-muted')
  const textFaint = css('--text-faint')
  const border = css('--background-modifier-border')
  const bgSecondary = css('--background-secondary')
  const accent = css('--interactive-accent')
  const success = css('--text-success') || '#16a34a'
  const error = css('--text-error') || '#dc2626'

  return {
    // Palette
    color: [accent, success, error, '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'],
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
      extraCssText: 'border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.15);',
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
  registerTheme(THEME_NAME, buildTheme())
  return init(el, THEME_NAME)
}

/** Get current resolved Obsidian CSS color values for use in chart options */
export function getThemeColors() {
  return {
    income: css('--text-success') || '#16a34a',
    expense: css('--text-error') || '#dc2626',
    accent: css('--interactive-accent'),
    text: css('--text-normal'),
    textMuted: css('--text-muted'),
    textFaint: css('--text-faint'),
    border: css('--background-modifier-border'),
    bgSecondary: css('--background-secondary'),
  }
}

export type { EChartsType }
