import { MapView, MAP_VIEW_ID, mapViewOptions } from '@/bases/MapView'
import { t } from '@/i18n'
import { CHART_VIEW_ID, ChartView } from '@/bases/ChartView'
import { BaseProbeView, probeFor } from '@/analytics/sources/baseProbe'
import { FIND_AND_REPLACE_VIEW_ID, FindAndReplaceView } from '@/bases/FindAndReplaceView'
import { CALENDAR_VIEW_ID, CalendarView, calendarViewOptions } from '@/bases/CalendarView'
import { TIMELINE_VIEW_ID, TimelineView, timelineViewOptions } from '@/bases/TimelineView'
import type { Plugin } from 'obsidian'
import { isPrintMode } from '@/markdown/printMode'
import { PrintView } from '@/bases/PrintView'

/** Startup section; called at its original lifecycle position. */
export function registerBasesViews(plugin: Plugin) {
  // Custom Bases view types for finance
  plugin.registerBasesView(CHART_VIEW_ID, {
    name: 'Chart',
    icon: 'chart-line',
    // Inside an offscreen probe host the same id reads a base's rows for the analytics tools
    // instead of drawing them — see `analytics/sources/baseProbe.ts`.
    factory: (controller, containerEl) => {
      const probe = probeFor(containerEl)
      return probe
        ? new BaseProbeView(controller, CHART_VIEW_ID, probe)
        : new ChartView(controller, containerEl)
    },
    options: () => [
      {
        key: 'chartType',
        type: 'dropdown' as const,
        displayName: 'Chart type',
        default: 'line',
        options: {
          line: 'Line',
          bar: 'Bar',
          scatter: 'Scatter',
        },
      },
      {
        key: 'dateProperty',
        type: 'property' as const,
        displayName: 'Date property (X axis)',
        placeholder: 'Leave empty to use file name',
      },
      {
        key: 'groupProperty',
        type: 'property' as const,
        displayName: 'Group by property',
        placeholder: 'Optional — split into separate series',
      },
      {
        key: 'showDots',
        type: 'toggle' as const,
        displayName: 'Show data points on lines',
        default: false,
      },
      {
        key: 'logScale',
        type: 'toggle' as const,
        displayName: 'Logarithmic scale',
        default: false,
      },
      {
        key: 'dualAxis',
        type: 'toggle' as const,
        displayName: 'Separate Y axis per series',
        default: false,
      },
      {
        key: 'timeAxis',
        type: 'toggle' as const,
        displayName: 'Proportional time axis',
        default: false,
      },
      {
        key: 'chartHeight',
        type: 'slider' as const,
        displayName: 'Chart height',
        default: 500,
        min: 200,
        max: 1000,
        step: 50,
      },
    ],
  })

  plugin.registerBasesView(FIND_AND_REPLACE_VIEW_ID, {
    name: 'Find and replace',
    icon: 'replace-all',
    factory: (controller, containerEl) =>
      isPrintMode(containerEl)
        ? new PrintView(controller, containerEl, FIND_AND_REPLACE_VIEW_ID)
        : new FindAndReplaceView(controller, containerEl),
  })

  // The notes a base finds on a month, a week or a year, placed by a date property.
  plugin.registerBasesView(CALENDAR_VIEW_ID, {
    name: 'Calendar',
    icon: 'calendar-days',
    factory: (controller, containerEl) =>
      isPrintMode(containerEl)
        ? new PrintView(controller, containerEl, CALENDAR_VIEW_ID)
        : new CalendarView(controller, containerEl),
    options: calendarViewOptions,
  })

  // History: people, events and eras on one line of years, placed by dates as notes write them.
  plugin.registerBasesView(TIMELINE_VIEW_ID, {
    name: 'Timeline',
    icon: 'gantt-chart',
    factory: (controller, containerEl) =>
      isPrintMode(containerEl)
        ? new PrintView(controller, containerEl, TIMELINE_VIEW_ID)
        : new TimelineView(controller, containerEl),
    options: timelineViewOptions,
  })
  plugin.registerBasesView(MAP_VIEW_ID, {
    name: t('maps.viewName'),
    icon: 'map',
    factory: (controller, containerEl) =>
      isPrintMode(containerEl)
        ? new PrintView(controller, containerEl, MAP_VIEW_ID)
        : new MapView(controller, containerEl),
    options: mapViewOptions,
  })
}
