import type { BackgroundSource } from '@/maps/backgroundStyle'
import { externalLinkPath } from '@/sync/external/fileAccess'
import { openAbeleSettings } from '@/components/settings/settingsTab'
import {
  BasesView,
  Keymap,
  Menu,
  Notice,
  type BasesAllOptions,
  type HoverPopover,
  type QueryController,
} from 'obsidian'
import { defineComponent, h, shallowReactive, watch } from 'vue'
import MapBaseView from '@/components/mapBase/MapBaseView.vue'
import MapFormulaCreate from '@/components/mapBase/MapFormulaCreate.vue'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import { confirmDialog } from '@/components/obsidian/dialogs'
import { openComponentDialog } from '@/modal/componentDialog'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  backgroundStyle,
  coordinates,
  writableCoordinateKey,
  wrapLongitude,
  type Camera,
} from '@/maps/core/model'
import { mapRows, mapValue, popupProperties } from './mapRows'
import type { MapPlace, MapSkipped } from '@/maps/core/records'
import type { MapProblem } from '@/components/mapBase/problems'
import { t } from '@/i18n'
import { cardContent } from '@/maps/cardContent'
import { vaultUrl } from '@/helpers/vaultUrl'

export const MAP_VIEW_ID = 'abele-map'
export function mapViewOptions(): BasesAllOptions[] {
  return [
    ...(['coordinates', 'markerIcon', 'markerColor'] as const).map((key) => ({
      key,
      type: 'property' as const,
      displayName: t(`maps.${key}`),
      filter: (p: string) => !p.startsWith('file.'),
    })),
    { key: 'center', type: 'formula', displayName: t('maps.center') },
    ...(['defaultZoom', 'minZoom', 'maxZoom', 'mapHeight'] as const).map((key) => ({
      key,
      type: 'slider' as const,
      displayName: t(`maps.${key}`),
      min: key === 'mapHeight' ? 100 : 0,
      max: key === 'mapHeight' ? 2000 : 24,
      step: 1,
      default: key === 'mapHeight' ? 400 : key === 'maxZoom' ? 18 : key === 'defaultZoom' ? 15 : 0,
    })),
    { key: 'groupNearby', type: 'toggle', displayName: t('maps.groupNearby'), default: true },
    { key: 'mapTiles', type: 'multitext', displayName: t('maps.mapTiles') },
    { key: 'mapTilesDark', type: 'multitext', displayName: t('maps.mapTilesDark') },
  ]
}

interface MapViewState {
  places: MapPlace[]
  skipped: MapSkipped[]
  group: boolean
  list: boolean
  contentToken: number
  styleUrl: ReturnType<typeof backgroundStyle>
  backgroundSource: BackgroundSource
  background: string
  backgrounds: { id: string; name: string }[]
  center?: { lat: number; lon: number }
  zoom?: number
  minZoom: number
  maxZoom: number
  embedded: boolean
  height: number
  retryToken: number
  themeToken: number
  restoredCamera?: Camera
  problem: MapProblem | null
}

/** Obsidian supplies filtering, toolbar search, sort and formula dependencies. Reads never save. */
export class MapView extends BasesView {
  type = MAP_VIEW_ID
  hoverPopover: HoverPopover | null = null
  private el: HTMLElement
  private mounted: KitMount | null = null
  private history: Camera | undefined
  private disposed = false
  private selectedBackground: string | null = null
  private renderProblem: MapProblem | null = null
  private dataProblem: MapProblem | null = null
  private state = shallowReactive<MapViewState>({
    places: [],
    skipped: [],
    group: true,
    list: false,
    contentToken: 0,
    styleUrl: backgroundStyle([]),
    backgroundSource: 'default',
    background: '',
    backgrounds: [],
    center: undefined,
    zoom: undefined,
    minZoom: 0,
    maxZoom: 18,
    embedded: false,
    height: 400,
    retryToken: 0,
    themeToken: 0,
    restoredCamera: undefined,
    problem: null,
  })
  constructor(controller: QueryController, container: HTMLElement) {
    super(controller)
    this.el = container.createDiv({ cls: 'abele-map-base-host' })
    this.el.tabIndex = 0
    this.state.embedded = !!container.closest('.bases-embed, .block-language-base')
  }
  onload(): void {
    // Body and image changes also refresh an open card when its Bases values stay the same.
    this.registerEvent(
      this.app.vault.on('modify', () => {
        this.state.contentToken++
      })
    )
    this.registerEvent(
      this.app.vault.on('delete', () => {
        this.state.contentToken++
      })
    )
    this.registerEvent(
      this.app.vault.on('rename', () => {
        this.state.contentToken++
      })
    )
    this.registerEvent(
      this.app.workspace.on('css-change', () => {
        this.state.themeToken++
        this.updateBackground()
      })
    )
    this.register(
      watch(
        () => AbeleConfig.getInstance().version.value,
        () => this.updateBackground()
      )
    )
  }
  onDataUpdated(): void {
    if (this.disposed) return
    this.state.contentToken++
    const config = this.config
    const selector = config.getAsPropertyId('coordinates')
    const result = mapRows(
      this.data.data,
      {
        coordinates: selector,
        icon: config.getAsPropertyId('markerIcon'),
        color: config.getAsPropertyId('markerColor'),
      },
      config.getOrder(),
      (id) => config.getDisplayName(id)
    )
    Object.assign(this.state, result)
    this.state.group = config.get('groupNearby') !== false
    let center: unknown = config.get('center')
    try {
      center = mapValue(config.getEvaluatedFormula(this, 'center')) ?? center
    } catch {
      /* Raw legacy coordinates remain supported. */
    }
    const parsed = coordinates(center)
    const point = 'point' in parsed ? parsed.point : undefined
    if (point?.lat !== this.state.center?.lat || point?.lon !== this.state.center?.lon)
      this.state.center = point
    const number = (key: string, fallback: number) =>
      typeof config.get(key) === 'number' && Number.isFinite(config.get(key))
        ? Number(config.get(key))
        : fallback
    this.state.zoom =
      typeof config.get('defaultZoom') === 'number' ? number('defaultZoom', 15) : undefined
    this.state.minZoom = Math.max(0, Math.min(24, number('minZoom', 0)))
    this.state.maxZoom = Math.max(this.state.minZoom, Math.min(24, number('maxZoom', 18)))
    this.state.height = Math.max(100, Math.min(2000, number('mapHeight', 400)))
    this.dataProblem = !selector
      ? 'no-property'
      : !this.data.data.length
        ? this.app.vault.getMarkdownFiles().length
          ? 'filtered'
          : 'no-records'
        : !result.places.length
          ? 'no-coordinates'
          : null
    this.state.problem = this.renderProblem ?? this.dataProblem
    this.updateBackground()
    if (!this.mounted) this.mount()
  }
  private mount(): void {
    this.mounted = mountKit(
      this.el,
      defineComponent({
        setup: () => () =>
          h(MapBaseView, {
            ...this.state,
            history: this.state.restoredCamera,
            loadPlace: (place: MapPlace) => this.loadPlace(place),
            'onUpdate:list': (on: boolean) => {
              this.state.list = on
            },
            renderHover: (place: MapPlace) => this.popup(place),
            decoratePlaceMenu: (menu: Menu, place: MapPlace) => {
              const file = this.app.vault.getFileByPath(place.path)
              if (file) this.app.workspace.trigger('file-menu', menu, file, 'link-context-menu')
            },
            onOpen: (place: MapPlace, where: 'here' | 'tab' | 'split' | 'window') =>
              this.open(place, where),
            onManageBackgrounds: () => openAbeleSettings(this.app, 'other'),
            onConfigure: () => this.configure(),
            onCopied: (text: string): void => {
              void this.copy(text)
            },
            onCreate: (lat: number, lon: number) => this.create(lat, lon),
            onRemove: (place: MapPlace): void => {
              void this.remove(place)
            },
            onCentre: (lat: number, lon: number): void =>
              this.config.set('center', `[${lat}, ${lon}]`),
            onSaveZoom: (zoom: number): void => this.config.set('defaultZoom', zoom),
            onCamera: (state: Camera) => {
              this.history = { ...state, center: [wrapLongitude(state.center[0]), state.center[1]] }
            },
            onFailure: (problem: MapProblem) => {
              this.renderProblem = problem
              this.state.problem = problem
            },
            onRetry: () => {
              this.renderProblem = null
              this.state.problem = this.dataProblem
              this.state.retryToken++
              this.updateBackground()
            },
            onBackground: (name: string) => {
              this.selectedBackground = name
              this.state.background = name
              this.updateBackground()
            },
            onHover: (place: MapPlace, event: MouseEvent) =>
              this.app.workspace.trigger('hover-link', {
                event,
                source: 'bases',
                hoverParent: this,
                targetEl: event.target,
                linktext: place.path,
                sourcePath: '',
              }),
          }),
      })
    )
  }
  private configure(): void {
    const menu = new Menu()
    for (const property of this.allProperties.filter((p) => !p.startsWith('file.'))) {
      menu.addItem((item) =>
        item
          .setTitle(this.config.getDisplayName(property))
          .setChecked(property === this.config.getAsPropertyId('coordinates'))
          .onClick(() => this.config.set('coordinates', property))
      )
    }
    const box = this.el.getBoundingClientRect()
    menu.showAtPosition({ x: box.left + 16, y: box.top + 16 })
  }
  private async loadPlace(place: MapPlace) {
    const file = this.app.vault.getFileByPath(place.path)
    if (!file) return { state: 'deleted' as const }
    try {
      const source = await this.app.vault.cachedRead(file)
      if (this.app.vault.getFileByPath(place.path) !== file) return { state: 'deleted' as const }
      return {
        state: 'ready' as const,
        ...cardContent(source, (path) => {
          const resolved = externalLinkPath(this.app, path, file.path)
          const image = resolved ? this.app.vault.getFileByPath(resolved) : null
          return image ? vaultUrl(this.app, image) : null
        }),
      }
    } catch {
      return {
        state: this.app.vault.getFileByPath(place.path) ? ('error' as const) : ('deleted' as const),
      }
    }
  }
  private updateBackground(): void {
    const settings = AbeleConfig.getInstance()
    const backgrounds = settings.mapBackgrounds ?? []
    if (
      this.selectedBackground !== 'view:tiles' &&
      !backgrounds.some((b) => `named:${b.id}` === this.selectedBackground)
    )
      this.selectedBackground = null
    const selected =
      backgrounds.find((b) => `named:${b.id}` === this.selectedBackground) ?? backgrounds[0]
    const urls = (v: unknown): string[] =>
      typeof v === 'string' && v.trim()
        ? [v.trim()]
        : Array.isArray(v)
          ? v.filter((x): x is string => typeof x === 'string' && !!x.trim())
          : []
    const light = urls(this.config.get('mapTiles'))
    const dark = urls(this.config.get('mapTilesDark'))
    const isDark = this.el.ownerDocument.body.classList.contains('theme-dark')
    const viewTiles =
      light.length > 0 && (!this.selectedBackground || this.selectedBackground === 'view:tiles')
    this.state.backgrounds = [
      ...(light.length ? [{ id: 'view:tiles', name: t('maps.mapTiles') }] : []),
      ...backgrounds.map((b) => ({ id: `named:${b.id}`, name: b.name })),
    ]
    this.state.background = viewTiles ? 'view:tiles' : selected ? `named:${selected.id}` : ''
    const chosenLight = viewTiles ? light : (selected?.light ?? [])
    const chosenDark = viewTiles ? dark : (selected?.dark ?? [])
    const chosenUrls = isDark && chosenDark.length ? chosenDark : chosenLight
    this.state.backgroundSource = viewTiles ? 'base' : chosenUrls.length ? 'settings' : 'default'
    const style = backgroundStyle(chosenUrls, isDark)
    if (JSON.stringify(this.state.styleUrl) !== JSON.stringify(style)) this.state.styleUrl = style
  }
  private open(place: MapPlace, where: 'here' | 'tab' | 'split' | 'window'): void {
    if (!this.app.vault.getFileByPath(place.path)) {
      new Notice(t('maps.placeGone'))
      return
    }
    void this.app.workspace.openLinkText(place.path, '', where === 'here' ? false : where)
  }
  private popup(place: MapPlace): HTMLElement | null {
    const row = this.data.data.find((entry) => entry.file.path === place.path)
    if (!row) return null
    const properties = popupProperties(
      row,
      this.config.getOrder(),
      ['coordinates', 'markerIcon', 'markerColor'].map((key) => this.config.getAsPropertyId(key))
    )
    if (!properties.length) return null
    const el = this.el.ownerDocument.win.createDiv({ cls: 'abele-map-hover' })
    const title = el.createEl('a', {
      cls: 'internal-link abele-map-hover__title',
      href: place.path,
      attr: { 'data-href': place.path },
    })
    properties[0].value.renderTo(title, this.app.renderContext)
    title.addEventListener('click', (event) => {
      event.preventDefault()
      this.open(place, Keymap.isModEvent(event) ? 'tab' : 'here')
    })
    const rest = el.createDiv({ cls: 'abele-map-hover__props' })
    for (const { id, value } of properties.slice(1)) {
      rest.createDiv({ cls: 'abele-map-hover__name', text: this.config.getDisplayName(id) })
      value.renderTo(rest.createDiv({ cls: 'abele-map-hover__value' }), this.app.renderContext)
    }
    return el
  }
  private async copy(text: string): Promise<void> {
    try {
      await this.el.ownerDocument.defaultView.navigator.clipboard.writeText(text)
      new Notice(t('maps.copied'))
    } catch {
      new Notice(t('maps.copyFailed'))
    }
  }
  private async remove(place: MapPlace): Promise<void> {
    if (
      !(await confirmDialog(
        { title: t('maps.delete'), message: place.path },
        { document: this.el.ownerDocument }
      ))
    )
      return
    const file = this.app.vault.getFileByPath(place.path)
    if (file) {
      try {
        await this.app.fileManager.trashFile(file)
      } catch {
        new Notice(t('maps.deleteFailed'))
      }
    }
  }
  private create(lat: number, lon: number): void {
    const selector = this.config.getAsPropertyId('coordinates')
    const key = writableCoordinateKey(selector)
    const write = (property: string) => {
      if (!property || property.startsWith('formula.') || property.startsWith('file.')) return
      void this.createFileForView(undefined, (fm: Record<string, unknown>) => {
        fm[property] = `${lat}, ${lon}`
      }).catch(() => new Notice(t('maps.createFailed')))
    }
    if (key) {
      write(key)
      return
    }
    const dialog = openComponentDialog(
      () => MapFormulaCreate,
      {
        formula: selector ?? '',
        coordinates: `${lat}, ${lon}`,
        properties: [
          ...new Set([
            AbeleConfig.getInstance().mapCoordinatesProperty || 'coordinates',
            ...this.allProperties.flatMap((p) => {
              const k = writableCoordinateKey(p)
              return k ? [k] : []
            }),
          ]),
        ],
        onCreate: (property: string) => {
          dialog.close()
          write(property)
        },
      },
      { document: this.el.ownerDocument }
    )
    this.register(() => dialog.close())
  }
  setEphemeralState(value: unknown): void {
    if (!value || typeof value !== 'object') return
    const v = value as { center?: { lng?: number; lat?: number }; zoom?: number }
    const point = coordinates([
      v.center?.lat,
      typeof v.center?.lng === 'number' ? wrapLongitude(v.center.lng) : v.center?.lng,
    ])
    if ('point' in point && typeof v.zoom === 'number' && Number.isFinite(v.zoom))
      this.history = { center: [point.point.lon, point.point.lat], zoom: v.zoom }
    this.state.restoredCamera = this.history
  }
  getEphemeralState(): unknown {
    return this.history
      ? {
          center: { lng: this.history.center[0], lat: this.history.center[1] },
          zoom: this.history.zoom,
        }
      : {}
  }
  focus(): void {
    this.el.focus({ preventScroll: true })
  }
  onunload(): void {
    this.disposed = true
    this.hoverPopover?.unload()
    this.hoverPopover = null
    this.mounted?.unmount()
    this.el.remove()
  }
}
