<template>
  <div
    :class="[
      'abele-map-base',
      {
        'abele-map-base_list': listShown,
        'abele-map-base_phone-list': phone && listShown,
        'abele-map-base_embedded': embedded,
      },
    ]"
    :style="embedded ? { height: `${height}px` } : undefined"
  >
    <div v-if="listShown" class="abele-map-base__side">
      <MapPlaceCard
        v-if="paneCard"
        :place="paneCard"
        :load-place="loadPlace"
        :content-token="contentToken"
        :distance="distances[paneCard.id]"
        pane
        @back="paneCard = null"
        @open="emit('open', paneCard!, 'here')"
        @copy="copy(paneCard!)"
        @photo="(i: number, photos) => openViewer({ ...paneCard!, photos }, i)"
        @menu="(e: MouseEvent) => placeMenuAt(paneCard!, e)"
      />
      <MapPlaceList
        v-else
        :places="ordered"
        :selected="selected"
        :sort-from="sortFrom"
        :distances="distances"
        :stale="stale && sortFrom === 'centre'"
        :searched="problem === 'searched'"
        :filtered="problem === 'filtered'"
        @select="pickFromList"
        @sort="openSortMenu"
        @resort="resort"
        @hide="hideList"
      />
    </div>

    <div class="abele-map-base__stage">
      <div ref="mapEl" :hidden="noMap" class="abele-map abele-map-base__map" />

      <div class="abele-map-base__corner">
        <div
          v-if="!batchOne && (!listShown || phone)"
          class="canvas-controls abele-map-base__plate-group"
        >
          <div class="canvas-control-group">
            <ControlItem
              :icon="phone ? 'list' : 'panel-left-open'"
              :tooltip="phone ? t('maps.showList') : t('maps.listBeside')"
              @click="showList"
            />
          </div>
        </div>
        <div
          v-if="skipped.length && problem !== 'no-coordinates'"
          class="abele-map-base__skipped"
          role="button"
          tabindex="0"
          :aria-label="skippedTip"
          @click="openSkipped"
          @keydown.enter.prevent="openSkipped"
        >
          <Icon icon="map-pin-off" no-hover :tooltip="skippedTip" />
          <span>{{ skipped.length }}</span>
        </div>
      </div>

      <MapControls
        v-if="!noMap"
        class="abele-map-base__controls"
        :state="controls"
        layers
        @zoom="(s: 1 | -1) => (s > 0 ? map?.zoomIn() : map?.zoomOut())"
        @north="map?.resetNorthPitch()"
        @locate="locate"
        @full="full"
        @layers="openBackgrounds"
      />

      <div v-if="plate" class="abele-map-base__notice">
        <EmptyState
          :icon="plate.icon"
          :title="plate.title"
          :text="plate.text"
          :variant="plate.variant"
        >
          <template v-if="plate.action" #action>
            <Button :text="plate.action" @click="plateAction" />
          </template>
        </EmptyState>
      </div>
    </div>

    <ObsidianModal
      v-if="card"
      :size="phone ? 'tall' : undefined"
      modal-class="abele-map-card-modal"
      @close="card = null"
    >
      <MapPlaceCard
        :place="card"
        :footer-host="cardFooter"
        :load-place="loadPlace"
        :content-token="contentToken"
        :distance="distances[card.id]"
        :state="cardState"
        @open="emit('open', card!, 'here')"
        @show="showOnMap(card!)"
        @copy="copy(card!)"
        @photo="(i: number, photos) => openViewer({ ...card!, photos }, i)"
        @menu="(e: MouseEvent) => placeMenuAt(card!, e)"
      />
      <template #footer><div ref="cardFooter" class="abele-map-base__card-actions" /></template>
    </ObsidianModal>
    <GalleryViewer
      v-if="viewer"
      :images="viewer.images"
      :start-index="viewer.index"
      :gallery-file-path="viewer.path"
      @close="viewer = null"
    />
  </div>
</template>

<script setup lang="ts">
// The plugin's own Bases view, t('maps.viewName'), beside Obsidian Maps' "Map" rather than in its place:
// it reads the same view settings, so a base moves over by picking it. Every note of the base that has coordinates as a mark of its glyph and
// colour, Obsidian Maps' behaviour first (a press opens the note, pointing shows the properties,
// the menus on a mark and on the map), and on top of it the place card, the list beside the map
// sorted by distance, and nearby places joined into groups. Nothing is written by looking: the
// view's centre and zoom change only by their menu items.
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { Keymap, Platform, Notice } from 'obsidian'
import type { Map as MapLibreMap, Marker, Popup, StyleSpecification } from 'maplibre-gl'
import { loadBackgroundStyle, type BackgroundSource } from '@/maps/backgroundStyle'
import { popupLayout } from '@/maps/core/popupLayout'
import { loadMaplibre } from '@/helpers/loadMaplibre'
import { ControlItem } from '../obsidian/ControlItem'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import { renderKit, unrenderKit } from '../obsidian/mount'
import GalleryViewer, { type ViewerImage } from '../GalleryViewer.vue'
import MapControls from '../map/MapControls.vue'
import MapPlaceCard, { type CardContent } from './MapPlaceCard.vue'
import { viewerPhotos } from '@/maps/cardContent'
import { pinElement } from './pins'
import { selectionLayout } from '@/maps/core/selection'
import MapPlaceList from './MapPlaceList.vue'
import MapPlaceHover from './MapPlaceHover.vue'
import { t } from '@/i18n'
import { mapLongPress } from '@/maps/longPress'
import { MapFollowing } from '@/maps/core/following'
import { PlaceLayers, PLACE_LAYER, CLUSTER_LAYER } from '@/maps/layers'
import { camera, wrapLongitude, type Camera } from '@/maps/core/model'
import { backgroundMenu, mapMenu, placeMenu, sortMenu, spotMenu } from './menus'
import { plateFor, type MapProblem } from './problems'
import {
  distance,
  formatDistance,
  type MapPlace,
  type MapSkipped,
  type MapSortFrom,
} from './places'
import { Menu } from 'obsidian'
import 'maplibre-gl/dist/maplibre-gl.css'
import './mapBase.css'

const props = withDefaults(
  defineProps<{
    places: MapPlace[]
    batchOne?: boolean
    loadPlace?: (place: MapPlace) => Promise<CardContent>
    contentToken?: number
    history?: Camera
    renderHover?: (place: MapPlace) => HTMLElement | null
    decoratePlaceMenu?: (menu: Menu, place: MapPlace) => void
    retryToken?: number
    themeToken?: number
    skipped?: MapSkipped[]
    /** Nearby grouping is enabled unless explicitly switched off. */
    group?: boolean
    /** The style the map is drawn with; empty draws a plain ground (no connection). */
    styleUrl: string | object
    backgroundSource?: BackgroundSource
    background: string
    backgrounds: (string | { id: string; name: string })[]
    center?: { lat: number; lon: number }
    zoom?: number
    minZoom?: number
    maxZoom?: number
    list?: boolean
    problem?: MapProblem | null
    searchText?: string
    me?: { lat: number; lon: number } | null
    following?: boolean
    locationOff?: boolean
    embedded?: boolean
    height?: number
    /** The note the cards act on is gone, or could not be read. */
    cardState?: 'ready' | 'deleted' | 'error'
  }>(),
  {
    skipped: () => [],
    group: true,
    minZoom: 0,
    maxZoom: 18,
    problem: null,
    height: 400,
    backgroundSource: 'base',
    cardState: 'ready',
    history: undefined,
    loadPlace: undefined,
    contentToken: 0,
    renderHover: undefined,
    decoratePlaceMenu: undefined,
    retryToken: 0,
    themeToken: 0,
    center: undefined,
    zoom: undefined,
    searchText: '',
    me: null,
  }
)
const emit = defineEmits<{
  open: [place: MapPlace, where: 'here' | 'tab' | 'split' | 'window']
  remove: [place: MapPlace]
  copied: [text: string]
  create: [lat: number, lon: number]
  centre: [lat: number, lon: number]
  saveZoom: [zoom: number]
  background: [name: string]
  manageBackgrounds: []
  configure: []
  filters: []
  retry: []
  locate: []
  full: []
  'update:list': [on: boolean]
  camera: [state: Camera]
  failure: [problem: MapProblem]
  hover: [place: MapPlace, event: MouseEvent]
}>()

const phone = Platform.isPhone
const mapEl = ref<HTMLElement>()
const map = shallowRef<MapLibreMap | null>(null)
const selected = ref<string | null>(null)
const card = shallowRef<MapPlace | null>(null)
const paneCard = shallowRef<MapPlace | null>(null)
const cardFooter = shallowRef<HTMLElement>()
const viewer = shallowRef<{ images: ViewerImage[]; index: number; path: string } | null>(null)
const listShown = computed(() => !!props.list)
const sortFrom = ref<MapSortFrom>('centre')
const sortCentre = ref<{ lat: number; lon: number } | null>(null)
const stale = ref(false)
const located = shallowRef<{ lat: number; lon: number } | null>(null)
const controls = reactive({
  turned: false,
  bearing: 0,
  locating: false,
  full: false,
  following: false,
  locationOff: false,
})
watch(
  () => [props.following, props.locationOff],
  () => {
    controls.following = !!props.following
    controls.locationOff = !!props.locationOff
  },
  { immediate: true }
)

const noMap = computed(() => props.problem === 'no-webgl')
const plate = computed(() =>
  plateFor(props.problem, { phone, query: props.searchText, notes: props.skipped.length })
)
const skippedTip = computed(() => t('maps.skipped', { count: props.skipped.length }))

// The list's order: the base's own, or nearest first from the person or the map's centre.
const location = computed(() => props.me ?? located.value)
const from = computed(() => (sortFrom.value === 'me' ? location.value : sortCentre.value) ?? null)
const distances = computed<Record<string, string>>(() => {
  // A distance means something from the person, or beside the list sorted from the centre.
  const origin =
    location.value && (sortFrom.value !== 'centre' || !listShown.value)
      ? location.value
      : listShown.value && sortFrom.value === 'centre'
        ? sortCentre.value
        : null
  if (!origin) return {}
  return Object.fromEntries(props.places.map((p) => [p.id, formatDistance(distance(origin, p))]))
})
const ordered = computed(() => {
  if (sortFrom.value === 'base' || !from.value) return props.places
  const o = from.value
  return [...props.places].sort((a, b) => distance(o, a) - distance(o, b))
})

// ── The map ────────────────────────────────────────────────────────────────────────────────
let hoverPopup: Popup | null = null
let hoverTimer = 0
let timerWindow: Window
let meMarker: Marker | null = null
let selectionMarker: Marker | null = null
let selectionOffset: [number, number] = [0, 0]
let lib: typeof import('maplibre-gl') | null = null

let layers: PlaceLayers | null = null
let styleGeneration = 0
let retainedBackground: StyleSpecification = { version: 8, sources: {}, layers: [] }
function requestBackground() {
  const m = map.value
  if (!m) return
  const generation = ++styleGeneration
  void loadBackgroundStyle(props.styleUrl, props.backgroundSource)
    .then((style) => {
      if (!disposed && map.value === m && generation === styleGeneration)
        m.setStyle(style, { diff: false })
    })
    .catch(() => {
      if (!disposed) emit('failure', 'offline')
    })
}
function drawMarks() {
  selectionMarker?.remove()
  selectionMarker = null
  const m = map.value
  const chosen = selectionLayout(
    props.places,
    selected.value,
    props.group,
    m
      ? (place) => {
          const container = m.getContainer()
          return {
            point: m.project([place.lon, place.lat]),
            width: container.clientWidth,
            height: container.clientHeight,
          }
        }
      : undefined
  )
  const place = chosen.place
  selectionOffset = chosen.offset
  if (place && map.value && lib) {
    const pin = pinElement(mapEl.value.ownerDocument, place, (event) => pressPlace(place, event))
    pin.addClass('is-selected')
    pin.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      event.stopPropagation()
      placeMenuAt(place, event)
    })
    if (!phone) {
      pin.addEventListener('mouseenter', () => showHover(place))
      pin.addEventListener('mouseleave', hideHoverSoon)
    }
    selectionMarker = new lib.Marker({ element: pin, offset: selectionOffset })
      .setLngLat([place.lon, place.lat])
      .addTo(map.value)
  }
  if (map.value && layers)
    void layers.update(chosen.points, props.group).catch(() => {
      if (!disposed) emit('failure', 'offline')
    })
}

/** Map presses open notes; phone presses open cards; the desktop list selects its row. */
function pressPlace(place: MapPlace, e?: MouseEvent) {
  if (e && Keymap.isModEvent(e)) return emit('open', place, 'tab')
  if (phone && !props.batchOne) {
    select(place.id)
    return openCard(place)
  }
  if (listShown.value) {
    select(place.id)
    return
  }
  emit('open', place, e && Keymap.isModEvent(e) ? 'tab' : 'here')
}

function showHover(place: MapPlace) {
  timerWindow?.clearTimeout(hoverTimer)
  if (!map.value || !lib) return
  if (!place.properties.length) return
  hoverPopup?.remove()
  const content = props.renderHover
    ? props.renderHover(place)
    : mapEl.value.ownerDocument.win.createDiv()
  if (!content) return
  if (!props.renderHover)
    renderKit(content, MapPlaceHover, {
      place,
      onOpen: (e: MouseEvent) => emit('open', place, Keymap.isModEvent(e) ? 'tab' : 'here'),
    })
  content.addEventListener('mouseenter', (event) => {
    timerWindow?.clearTimeout(hoverTimer)
    emit('hover', place, event)
  })
  content.addEventListener('mouseleave', hideHoverSoon)
  const container = map.value.getContainer()
  const projected = map.value.project([place.lon, place.lat])
  const shift = selected.value === place.id ? selectionOffset : [0, 0]
  const layout = popupLayout(
    { width: container.clientWidth, height: container.clientHeight },
    { x: projected.x + shift[0], y: projected.y + shift[1] },
    parseFloat(
      container.ownerDocument.defaultView.getComputedStyle(container).getPropertyValue('--size-4-3')
    ) || 12
  )
  content.setCssProps({ '--abele-map-popup-height': `${layout.height}px` })
  const popup = new lib.Popup({
    closeButton: false,
    closeOnClick: false,
    anchor: layout.anchor,
    offset: [layout.offset[0] + shift[0], layout.offset[1] + shift[1]],
    className: 'abele-map-base__hover',
    maxWidth: `${layout.width}px`,
  })
    .setLngLat([place.lon, place.lat])
    .setDOMContent(content)
    .addTo(map.value)
  popup.on('close', () => {
    if (!props.renderHover) unrenderKit(content)
  })
  hoverPopup = popup
}

function hideHoverSoon() {
  timerWindow?.clearTimeout(hoverTimer)
  hoverTimer = timerWindow.setTimeout(() => {
    hoverPopup?.remove()
    hoverPopup = null
  }, 300)
}

/** Where a menu opened from an element appears: under it, as Obsidian's own do. */
function below(el: Element) {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.bottom + 4 }
}
/** The layers glyph stands at the right edge: its menu opens to its left, level with it. */
function leftOf(e: Event) {
  const el = ((e.currentTarget || e.target) as Element | null)?.closest('.canvas-control-item')
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  return { x: r.left - 4, y: r.top, left: true }
}
/** A menu opened by a control: under the control, whichever way it was pressed. */
function under(e: Event) {
  const el = (e.currentTarget || e.target) as Element | null
  return el?.instanceOf(Element)
    ? below(el.closest('[role=button], .canvas-control-item') ?? el)
    : { x: 0, y: 0 }
}

function openGroup(places: MapPlace[], spot: boolean, position: { x: number; y: number }) {
  if (!spot && map.value && lib) {
    const b = new lib.LngLatBounds()
    places.forEach((p) => b.extend([p.lon, p.lat]))
    map.value.fitBounds(b, { padding: 80, maxZoom: props.maxZoom })
    return
  }
  spotMenu(places, (p) =>
    props.batchOne
      ? emit('open', p, 'here')
      : listShown.value && !phone
        ? pickFromList(p)
        : openCard(p)
  ).showAtPosition(position)
}

function placeMenuAt(place: MapPlace, e: MouseEvent) {
  hoverPopup?.remove()
  const menu = placeMenu(
    place,
    {
      open: (p, where) => emit('open', p, where),
      card: props.batchOne ? (p) => emit('open', p, 'here') : openCard,
      copy,
      remove: (p) => emit('remove', p),
    },
    !props.batchOne
  )
  props.decoratePlaceMenu?.(menu, place)
  menu.showAtMouseEvent(e)
}

function mapMenuAt(lat: number, lon: number, x: number, y: number) {
  lon = wrapLongitude(lon)
  const zoom = map.value?.getZoom() ?? 12
  mapMenu(lat, lon, zoom, {
    create: () => emit('create', lat, lon),
    copy: () => emit('copied', `${lat.toFixed(5)}, ${lon.toFixed(5)}`),
    centre: () => emit('centre', lat, lon),
    zoom: () => emit('saveZoom', Math.round(zoom * 10) / 10),
  }).showAtPosition({ x, y })
}

function copy(place: MapPlace) {
  emit('copied', `${place.lat}, ${place.lon}`)
}

function openCard(place: MapPlace) {
  hoverPopup?.remove()
  select(place.id)
  if (listShown.value && !phone) paneCard.value = place
  else card.value = place
}

function openViewer(place: MapPlace, index: number) {
  const data = viewerPhotos(place.photos ?? [], index)
  if (data) viewer.value = { ...data, path: place.path }
}

function showOnMap(place: MapPlace) {
  card.value = null
  if (phone && listShown.value) emit('update:list', false)
  select(place.id)
  map.value?.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.value.getZoom(), 15) })
}

function pickFromList(place: MapPlace, e?: MouseEvent) {
  if (e && Keymap.isModEvent(e)) return emit('open', place, 'tab')
  select(place.id)
  const m = map.value
  if (!m) {
    if (phone) openCard(place)
    return
  }
  const p = m.project([place.lon, place.lat])
  const c = m.getContainer()
  if (p.x < 40 || p.y < 40 || p.x > c.clientWidth - 40 || p.y > c.clientHeight - 40)
    m.easeTo({ center: [place.lon, place.lat] })
  if (phone) openCard(place)
}

function select(id: string | null) {
  selected.value = id
  drawMarks()
}

function showList() {
  emit('update:list', true)
}
function hideList() {
  paneCard.value = null
  emit('update:list', false)
}

function openSortMenu(e: MouseEvent) {
  sortMenu(sortFrom.value, !!location.value, (f) => {
    sortFrom.value = f
    if (f === 'centre') resort()
  }).showAtPosition(under(e))
}
function resort() {
  const c = map.value?.getCenter()
  if (c) sortCentre.value = { lat: c.lat, lon: c.lng }
  stale.value = false
}

function openBackgrounds(e: MouseEvent) {
  backgroundMenu(
    props.backgrounds,
    props.background,
    (n) => emit('background', n),
    () => emit('manageBackgrounds')
  ).showAtPosition(leftOf(e))
}

function openSkipped(e: MouseEvent | KeyboardEvent) {
  const menu = new Menu()
  menu.addItem((i) => i.setTitle(skippedTip.value).setIsLabel(true))
  for (const s of props.skipped) {
    menu.addItem((i) =>
      i
        .setTitle(
          `${s.title} · ${s.detail ?? t(s.reason === 'no-coordinates' ? 'maps.noCoordinates' : s.reason === 'formula-error' ? 'maps.formulaError' : 'maps.unreadable')}`
        )
        .setIcon(s.reason === 'no-coordinates' ? 'file' : 'file-warning')
        .onClick(() =>
          emit(
            'open',
            { id: s.path, path: s.path, title: s.title, lat: 0, lon: 0, properties: [] },
            'here'
          )
        )
    )
  }
  menu.showAtPosition(under(e))
}

function plateAction(e: MouseEvent) {
  const p = props.problem
  if (p === 'no-property') emit('configure')
  else if (p === 'filtered') emit('filters')
  else if (p === 'offline' || p === 'lost-context') emit('retry')
  else if (p === 'no-webgl') emit('update:list', true)
  else if (p === 'no-coordinates') openSkipped(e)
}

async function create() {
  if (noMap.value || !mapEl.value) return
  timerWindow = mapEl.value.ownerDocument.defaultView
  lib = await loadMaplibre()
  if (disposed) return
  const initial = camera(
    props.places,
    {
      center: props.center ? [props.center.lat, props.center.lon] : null,
      zoom: props.zoom,
      minZoom: props.minZoom,
      maxZoom: props.maxZoom,
    },
    props.history
  )
  const m = new lib.Map({
    container: mapEl.value,
    // Places become usable immediately, independently of the background server's response.
    style:
      typeof props.styleUrl === 'string'
        ? retainedBackground
        : (props.styleUrl as StyleSpecification),
    // Nothing to fit and no centre set: the whole world, not a point in the ocean at 0, 0.
    center: initial.center,
    zoom: initial.zoom,
    minZoom: props.minZoom,
    maxZoom: props.maxZoom,
    // A tall viewport must not silently raise an explicitly configured zoom of zero.
    transformConstrain: (center, zoom) => ({
      center: new lib.LngLat(center.lng, Math.max(-85.051129, Math.min(85.051129, center.lat))),
      zoom: Math.max(props.minZoom, Math.min(props.maxZoom, zoom)),
    }),
    cooperativeGestures: !!props.embedded,
    attributionControl: { compact: true },
    locale: {
      'Map.Title': t('maps.viewName'),
      'Marker.Title': t('maps.currentLocation'),
      'AttributionControl.ToggleAttribution': t('maps.attribution'),
      'AttributionControl.MapFeedback': t('maps.feedback'),
      'CooperativeGesturesHandler.WindowsHelpText': t('maps.scrollHelp', { key: 'Ctrl' }),
      'CooperativeGesturesHandler.MacHelpText': t('maps.scrollHelp', { key: '⌘' }),
      'CooperativeGesturesHandler.MobileHelpText': t('maps.touchHelp'),
    },
  })
  map.value = m
  layers = new PlaceLayers(m, mapEl.value.ownerDocument)
  m.on('style.load', () => {
    retainedBackground = m.getStyle()
    drawMarks()
  })
  m.on('error', () => {
    emit('failure', 'offline')
    // A failed style URL must not prevent the base's own places from being drawn.
    if (!m.getStyle()?.version) m.setStyle(retainedBackground)
  })
  m.on('idle', () => {
    if (!m.getSource('abele-places')) drawMarks()
  })
  m.on('webglcontextlost', () => emit('failure', 'lost-context'))
  m.on('click', PLACE_LAYER, (event) => {
    const id = event.features?.[0]?.properties?.id
    const place = props.places.find((p) => p.id === id)
    if (place) pressPlace(place, event.originalEvent)
  })
  m.on('mouseenter', PLACE_LAYER, (event) => {
    m.getCanvas().addClass('abele-map-base__pointer')
    const place = props.places.find((p) => p.id === event.features?.[0]?.properties?.id)
    if (place && !phone) showHover(place)
  })
  m.on('mouseleave', PLACE_LAYER, () => {
    m.getCanvas().removeClass('abele-map-base__pointer')
    hideHoverSoon()
  })
  m.on('contextmenu', PLACE_LAYER, (event) => {
    const place = props.places.find((p) => p.id === event.features?.[0]?.properties?.id)
    if (place) {
      event.originalEvent.preventDefault()
      placeMenuAt(place, event.originalEvent)
    }
  })
  m.on('click', CLUSTER_LAYER, (event) => {
    void (async () => {
      const feature = event.features?.[0]
      if (!feature) return
      const source = layers.source()
      const id = Number(feature.properties?.cluster_id)
      const leaves = await source.getClusterLeaves(id, Number(feature.properties?.point_count), 0)
      if (disposed) return
      const ids = new Set(leaves.map((f) => f.properties?.id))
      const places = props.places.filter((p) => ids.has(p.id))
      const same = places.every((p) => p.lat === places[0]?.lat && p.lon === places[0]?.lon)
      if (same || m.getZoom() >= props.maxZoom - 1)
        openGroup(places, true, { x: event.originalEvent.clientX, y: event.originalEvent.clientY })
      else m.easeTo({ center: event.lngLat, zoom: await source.getClusterExpansionZoom(id) })
    })().catch(() => console.debug('[maps] Cluster changed before it could open'))
  })
  resize = new ResizeObserver(() => m.resize())
  resize.observe(mapEl.value)

  m.addControl(new lib.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  m.on('load', () =>
    mapEl.value
      ?.querySelector('.maplibregl-ctrl-attrib')
      ?.classList.remove('maplibregl-compact-show')
  )
  m.on('dragstart', () => locationFollow?.pan())
  m.on('rotate', () => {
    controls.bearing = m.getBearing()
    controls.turned = Math.abs(controls.bearing) > 0.5
  })
  m.on('moveend', () => {
    emit('camera', { center: [m.getCenter().lng, m.getCenter().lat], zoom: m.getZoom() })
    if (sortFrom.value === 'centre' && sortCentre.value) {
      const c = m.getCenter()
      stale.value = distance(sortCentre.value, { lat: c.lat, lon: c.lng }) > 0.1
    }
  })
  m.on('contextmenu', (e) => {
    e.originalEvent.preventDefault()
    if (
      m.queryRenderedFeatures(e.point, {
        layers: m.getLayer(PLACE_LAYER) ? [PLACE_LAYER, CLUSTER_LAYER] : [],
      }).length
    )
      return
    mapMenuAt(e.lngLat.lat, e.lngLat.lng, e.originalEvent.clientX, e.originalEvent.clientY)
  })
  wireLongPress(m)
  // The view may have been laid out after the map was made: measure again before fitting.
  m.resize()
  if (!props.history && !props.center && props.places.length) {
    const b = new lib.LngLatBounds()
    props.places.forEach((p) => b.extend([p.lon, p.lat]))
    if (props.places.length === 1) m.jumpTo({ center: b.getCenter(), zoom: props.zoom ?? 15 })
    else
      m.fitBounds(b, {
        padding: { top: 60, bottom: 60, left: 60, right: 90 },
        animate: false,
        maxZoom: props.zoom ?? 16,
      })
  }
  if (!props.history && props.zoom != null) m.setZoom(props.zoom)
  resort()
  drawMarks()
  drawMe()
  if (typeof props.styleUrl === 'string') requestBackground()
}

/** A phone has no right press: holding a finger still on the map opens the same menu. */
function wireLongPress(m: MapLibreMap) {
  const canvas = m.getCanvasContainer()
  cancelLongPress = mapLongPress(canvas, (x, y) => {
    const box = canvas.getBoundingClientRect()
    const point: [number, number] = [x - box.left, y - box.top]
    const ll = m.unproject(point)
    const features = m.getLayer(PLACE_LAYER)
      ? m.queryRenderedFeatures(point, { layers: [PLACE_LAYER] })
      : []
    const place = props.places.find((p) => p.id === features[0]?.properties?.id)
    if (place) placeMenuAt(place, new MouseEvent('contextmenu', { clientX: x, clientY: y }))
    else mapMenuAt(ll.lat, ll.lng, x, y)
  })
}

function drawMe() {
  meMarker?.remove()
  meMarker = null
  if (!props.me || !map.value || !lib) return
  const dot = mapEl.value.ownerDocument.win.createDiv()
  dot.className = 'abele-map-base__me'
  meMarker = new lib.Marker({ element: dot })
    .setLngLat([props.me.lon, props.me.lat])
    .addTo(map.value)
}

watch(() => [props.places, props.group], drawMarks)
watch(() => props.me, drawMe)
watch(() => [props.styleUrl, props.backgroundSource, props.themeToken] as const, requestBackground)
watch(
  () => props.history,
  (state) => {
    if (state) map.value?.jumpTo(state)
  }
)
watch(
  () => props.retryToken,
  () => {
    if (map.value) requestBackground()
    else void create().catch(() => emit('failure', 'no-webgl'))
  }
)
// A place gone from the base (a filter, the search) is no longer picked.
watch(
  () => props.places,
  (list) => {
    if (paneCard.value)
      paneCard.value = list.find((p) => p.id === paneCard.value?.id) ?? paneCard.value
    if (card.value) card.value = list.find((p) => p.id === card.value?.id) ?? card.value
    if (selected.value && !list.some((p) => p.id === selected.value)) {
      select(null)
      paneCard.value = null
    }
  }
)
// The list opening or closing changes the map's width: MapLibre is told, the view stays put.
watch(listShown, () =>
  mapEl.value?.ownerDocument.defaultView?.requestAnimationFrame(() => map.value?.resize())
)

let disposed = false
let resize: ResizeObserver | null = null
let cancelLongPress = () => {}
let stopFullscreen = () => {}
let locationFollow: MapFollowing | null = null
function locate() {
  if (!locationFollow)
    locationFollow = new MapFollowing(
      mapEl.value?.ownerDocument.defaultView?.navigator.geolocation,
      (point) => {
        map.value?.easeTo({
          center: [point.lon, point.lat],
          zoom: Math.min(props.maxZoom, Math.max(15, map.value.getZoom())),
        })
        drawLocation(point)
      },
      (error) => {
        controls.following = !!locationFollow?.active
        controls.locating = !!locationFollow?.pending
        controls.locationOff = !!locationFollow?.denied
        if (error)
          new Notice(
            t(
              error === 1
                ? 'maps.locationDenied'
                : error === 3
                  ? 'maps.locationTimeout'
                  : 'maps.locationUnavailable'
            )
          )
      }
    )
  locationFollow.toggle()
}
function drawLocation(point: { lat: number; lon: number }) {
  located.value = point
  meMarker?.remove()
  if (!lib || !map.value || !mapEl.value) return
  const dot = mapEl.value.ownerDocument.win.createDiv()
  dot.className = 'abele-map-base__me'
  meMarker = new lib.Marker({ element: dot }).setLngLat([point.lon, point.lat]).addTo(map.value)
}
function full() {
  const el = mapEl.value?.closest('.abele-map-base')
  if (!el) return
  if (el.ownerDocument.fullscreenElement)
    void el.ownerDocument.exitFullscreen().catch(() => new Notice(t('maps.fullUnavailable')))
  else if (typeof el.requestFullscreen === 'function')
    void el.requestFullscreen().catch(() => new Notice(t('maps.fullUnavailable')))
  else new Notice(t('maps.fullUnavailable'))
}
watch(
  () => props.center,
  (c) => {
    if (c) map.value?.setCenter([c.lon, c.lat])
  }
)
watch(
  () => props.zoom,
  (z) => {
    if (z != null) map.value?.setZoom(z)
  }
)
watch(
  () => [props.minZoom, props.maxZoom],
  () => {
    map.value?.setMinZoom(props.minZoom)
    map.value?.setMaxZoom(props.maxZoom)
  }
)
onMounted(() => {
  const doc = mapEl.value.ownerDocument
  const updateFullscreen = () => {
    controls.full = !!doc.fullscreenElement
  }
  doc.addEventListener('fullscreenchange', updateFullscreen)
  stopFullscreen = () => doc.removeEventListener('fullscreenchange', updateFullscreen)
  void create().catch(() => emit('failure', 'no-webgl'))
})
onUnmounted(() => {
  disposed = true
  resize?.disconnect()
  cancelLongPress()
  stopFullscreen()
  layers?.dispose()
  locationFollow?.dispose()
  meMarker?.remove()
  selectionMarker?.remove()
  timerWindow?.clearTimeout(hoverTimer)
  hoverPopup?.remove()
  map.value?.remove()
})

defineExpose({
  map,
  openCard,
  select,
  pressPlace,
  showList,
  hideList,
  resort,
  pickFromList,
  hoverPlace: (id: string) => {
    const p = props.places.find((x) => x.id === id)
    if (p) showHover(p)
  },
  placeMenuAt: (id: string, x: number, y: number) => {
    const p = props.places.find((q) => q.id === id)
    if (p) placeMenuAt(p, new MouseEvent('contextmenu', { clientX: x, clientY: y }))
  },
  mapMenuAt,
  openBackgrounds,
  openSkipped,
  openSortMenu,
  openViewer,
  sortBy: (f: MapSortFrom) => (sortFrom.value = f),
  markStale: () => (stale.value = true),
})
</script>
