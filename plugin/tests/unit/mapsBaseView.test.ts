import { afterEach, expect, it, vi } from 'vitest'
import { nextTick, shallowRef } from 'vue'
import type { QueryController } from 'obsidian'
import { MapView } from '@/bases/MapView'
import type { Background } from '@/maps/core/model'

const captured = vi.hoisted(() => ({
  props: null as Record<string, any> | null,
  dialog: null as Record<string, any> | null,
  backgrounds: [] as Background[],
}))
vi.mock('@/components/mapBase/MapBaseView.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      setup(_, { attrs }) {
        captured.props = attrs
        return () => h('div')
      },
    }),
  }
})
vi.mock('@/components/mapBase/MapFormulaCreate.vue', () => ({ default: {} }))
vi.mock('@/services/AbeleConfig', () => ({
  AbeleConfig: {
    getInstance: () => ({
      mapBackgrounds: captured.backgrounds,
      mapCoordinatesProperty: 'position',
      version: shallowRef(0),
    }),
  },
}))
vi.mock('@/modal/componentDialog', () => ({
  openComponentDialog: (_: unknown, props: Record<string, unknown>) => {
    captured.dialog = props
    return { close: vi.fn() }
  },
}))
vi.mock('obsidian', async (original) => {
  class StringValue {
    constructor(private value: string) {}
    toString() {
      return this.value
    }
    isTruthy() {
      return !!this.value
    }
  }
  class BasesView {
    constructor(controller: object) {
      Object.assign(this, controller)
    }
    createFileForView = vi.fn(
      async (_: unknown, processor: (fm: Record<string, unknown>) => void) => {
        const fm = {}
        processor(fm)
        return fm
      }
    )
    register() {}
    registerEvent() {}
  }
  return {
    ...(await original<object>()),
    BasesView,
    StringValue,
    NullValue: class {},
    ListValue: class {},
  }
})
afterEach(() => {
  captured.props = captured.dialog = null
  document.body.empty()
})

it('reads without writes, preserves a moved camera on row updates, and gates formula creation', async () => {
  const { StringValue } = await import('obsidian')
  const config = {
    get: (key: string) => (key === 'center' ? '0, 0' : undefined),
    getAsPropertyId: (key: string) => (key === 'coordinates' ? 'formula.position' : null),
    getEvaluatedFormula: () => null,
    getOrder: () => [],
    getDisplayName: (id: string) => id,
    set: vi.fn(),
  }
  const controller = {
    config,
    allProperties: ['note.position'],
    data: {
      data: [
        {
          file: { path: 'Sample.md', basename: 'Sample' },
          getValue: () => new StringValue('1, 2'),
        },
      ],
    },
    app: {
      vault: { getMarkdownFiles: () => [{}], getFileByPath: () => null },
      workspace: { openLinkText: vi.fn() },
    },
  }
  const host = document.body.createDiv()
  const view = new MapView(controller as unknown as QueryController, host)
  view.onDataUpdated()
  await nextTick()
  expect(captured.props?.places).toMatchObject([{ lat: 1, lon: 2 }])
  expect(config.set).not.toHaveBeenCalled()
  const create = (view as unknown as { createFileForView: ReturnType<typeof vi.fn> })
    .createFileForView
  expect(create).not.toHaveBeenCalled()
  captured.props!.onCamera({ center: [7, 8], zoom: 9 })
  view.onDataUpdated()
  await nextTick()
  expect(view.getEphemeralState()).toEqual({ center: { lng: 7, lat: 8 }, zoom: 9 })
  expect(config.set).not.toHaveBeenCalled()
  captured.props!.onFailure('offline')
  view.onDataUpdated()
  await nextTick()
  expect(captured.props!.problem).toBe('offline')
  captured.props!.onRetry()
  await nextTick()
  expect(captured.props!.problem).toBeNull()
  captured.backgrounds = [
    { id: 'one', name: 'Sample background', light: ['https://example.test/one.json'], dark: [] },
    { id: 'two', name: 'Sample background', light: ['https://example.test/two.json'], dark: [] },
  ]
  view.onDataUpdated()
  await nextTick()
  expect(captured.props!.backgrounds.map((entry: { id: string }) => entry.id)).toEqual([
    'named:one',
    'named:two',
  ])
  captured.props!.onBackground('named:two')
  await nextTick()
  expect(captured.props!.styleUrl).toBe('https://example.test/two.json')
  captured.backgrounds = [captured.backgrounds[0]]
  view.onDataUpdated()
  await nextTick()
  expect(captured.props!.styleUrl).toBe('https://example.test/one.json')
  expect(config.set).not.toHaveBeenCalled()
  captured.props!.onCreate(12, 20)
  expect(create).not.toHaveBeenCalled()
  expect(captured.dialog?.formula).toBe('formula.position')
  captured.dialog!.onCreate('position')
  expect(await create.mock.results[0].value).toEqual({ position: '12, 20' })
  captured.props!.onCentre(0, 0)
  expect(config.set).toHaveBeenCalledWith('center', '[0, 0]')
  captured.props!.onOpen({ path: 'Removed sample.md' }, 'here')
  expect(controller.app.workspace.openLinkText).not.toHaveBeenCalled()
  view.onunload()
  expect(host.children).toHaveLength(0)
})
