import { afterEach, describe, expect, it, vi } from 'vitest'
import AbelePlugin from '@/main'
import { AbeleConfig } from '@/services/AbeleConfig'
import { TemplateService } from '@/templates/TemplateService'
import { useVault } from '../helpers/testEnv'

// Characterize the existing sections before moving them out of the lifecycle class.
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('startup sections', () => {
  it('registers the same bases views, chart controls and defaults in order', () => {
    const registerBasesView = vi.fn()
    const plugin = Object.assign(Object.create(AbelePlugin.prototype), { registerBasesView })
    plugin.registerBasesViews()
    expect(
      registerBasesView.mock.calls.map(([id, descriptor]) => [id, descriptor.name, descriptor.icon])
    ).toEqual([
      ['abele-chart', 'Chart', 'chart-line'],
      ['abele-find-and-replace', 'Find and replace', 'replace-all'],
      ['abele-calendar', 'Calendar', 'calendar-days'],
      ['abele-timeline', 'Timeline', 'gantt-chart'],
      ['abele-map', 'Abele map', 'map'],
    ])
    expect(registerBasesView.mock.calls.some(([id]) => id === 'map')).toBe(false)
    const mapOptions = registerBasesView.mock.calls[4][1].options()
    expect(
      mapOptions.find((option: { key: string }) => option.key === 'groupNearby')
    ).toMatchObject({ default: true })
    expect(mapOptions.map((option: { key: string }) => option.key)).toEqual(
      expect.arrayContaining([
        'coordinates',
        'markerIcon',
        'markerColor',
        'center',
        'defaultZoom',
        'minZoom',
        'maxZoom',
        'mapHeight',
        'mapTiles',
        'mapTilesDark',
      ])
    )
    expect(registerBasesView.mock.calls[0][1].options()).toEqual([
      {
        key: 'chartType',
        type: 'dropdown',
        displayName: 'Chart type',
        default: 'line',
        options: { line: 'Line', bar: 'Bar', scatter: 'Scatter' },
      },
      {
        key: 'dateProperty',
        type: 'property',
        displayName: 'Date property (X axis)',
        placeholder: 'Leave empty to use file name',
      },
      {
        key: 'groupProperty',
        type: 'property',
        displayName: 'Group by property',
        placeholder: 'Optional — split into separate series',
      },
      { key: 'showDots', type: 'toggle', displayName: 'Show data points on lines', default: false },
      { key: 'logScale', type: 'toggle', displayName: 'Logarithmic scale', default: false },
      {
        key: 'dualAxis',
        type: 'toggle',
        displayName: 'Separate Y axis per series',
        default: false,
      },
      { key: 'timeAxis', type: 'toggle', displayName: 'Proportional time axis', default: false },
      {
        key: 'chartHeight',
        type: 'slider',
        displayName: 'Chart height',
        default: 500,
        min: 200,
        max: 1000,
        step: 50,
      },
    ])
  })

  it('defers the default template hook until layout and waits before reading a new note', async () => {
    vi.useFakeTimers()
    const app = useVault([{ path: 'Notes/sample.md', content: '' }])
    const ready: (() => void)[] = []
    const events = vi.fn()
    const protocol = vi.fn()
    Object.assign(app.workspace, { onLayoutReady: (fn: () => void) => ready.push(fn) })
    const plugin = Object.assign(Object.create(AbelePlugin.prototype), {
      app,
      registerEvent: events,
      registerObsidianProtocolHandler: protocol,
    })
    const config = AbeleConfig.getInstance()
    vi.spyOn(config, 'isPathExcludedFromDefaultTemplate').mockReturnValue(false)
    config.journals = []
    const apply = vi
      .spyOn(TemplateService.getInstance(), 'applyDefaultTemplate')
      .mockResolvedValue(undefined)
    plugin.registerLinks()
    expect(protocol.mock.calls[0][0]).toBe('abele')
    expect(events).not.toHaveBeenCalled()
    ready.forEach((fn) => fn())
    expect(events).toHaveBeenCalledOnce()
    const file = app.vault.getFileByPath('Notes/sample.md')!
    app.emit('vault', 'create', file)
    await vi.advanceTimersByTimeAsync(999)
    expect(apply).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(apply).toHaveBeenCalledWith(file, true)
  })
})
