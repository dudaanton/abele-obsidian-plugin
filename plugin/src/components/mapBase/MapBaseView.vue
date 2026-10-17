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
        :distance="distances[paneCard.id]"
        pane
        @back="paneCard = null"
        @open="emit('open', paneCard!, 'here')"
        @copy="copy(paneCard!)"
        @photo="(i: number) => openViewer(paneCard!, i)"
        @menu="(e: MouseEvent) => placeMenuAt(paneCard!, e)"
      />
      <MapPlaceList
        v-else
        :places="ordered"
        :selected="selected"
        :sort-from="sortFrom"
        :distances="distances"
        :stale="stale"
        :searched="problem === 'searched'"
        @select="pickFromList"
        @hover="(id: string | null) => (hovered = id)"
        @sort="openSortMenu"
        @resort="resort"
        @hide="hideList"
      />
    </div>

    <div class="abele-map-base__stage">
      <div ref="mapEl" class="abele-map abele-map-base__map" />

      <div class="abele-map-base__corner">
        <div v-if="!listShown || phone" class="canvas-controls abele-map-base__plate-group">
          <div class="canvas-control-group">
            <ControlItem
              :icon="phone ? 'list' : 'panel-left-open'"
              :tooltip="phone ? 'Show as a list' : 'List beside the map'"
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
        @locate="emit('locate')"
        @full="emit('full')"
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

    <ObsidianModal v-if="card" :size="phone ? 'tall' : undefined" modal-class="abele-map-card-modal" @close="card = null">
      <MapPlaceCard
        :place="card"
        :distance="distances[card.id]"
        :state="cardState"
        @open="emit('open', card!, 'here')"
        @show="showOnMap(card!)"
        @copy="copy(card!)"
        @photo="(i: number) => openViewer(card!, i)"
        @menu="(e: MouseEvent) => placeMenuAt(card!, e)"
      />
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
// The Bases "Map" view: every note of the base that has coordinates as a mark of its glyph and
// colour, Obsidian Maps' behaviour first (a press opens the note, pointing shows the properties,
// the menus on a mark and on the map), and on top of it the place card, the list beside the map
// sorted by distance, and nearby places joined into groups. Nothing is written by looking: the
// view's centre and zoom change only by their menu items.
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue'
import { Keymap, Platform } from 'obsidian'
import type { Map as MapLibreMap, Marker, Popup } from 'maplibre-gl'
import { loadMaplibre } from '@/helpers/loadMaplibre'
import { ControlItem } from '../obsidian/ControlItem'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import { renderKit, unrenderKit } from '../obsidian/mount'
import GalleryViewer, { type ViewerImage } from '../GalleryViewer.vue'
import MapControls from '../map/MapControls.vue'
import MapPlaceCard from './MapPlaceCard.vue'
import MapPlaceList from './MapPlaceList.vue'
import MapPlaceHover from './MapPlaceHover.vue'
import { groupElement, pinElement } from './pins'
import { backgroundMenu, mapMenu, placeMenu, sortMenu, spotMenu } from './menus'
import { plateFor, type MapProblem } from './problems'
import {
  distance,
  formatDistance,
  groupMarks,
  skipWords,
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
    skipped?: MapSkipped[]
    /** Join nearby places; a view saved before the setting existed keeps separate marks. */
    group?: boolean
    /** The style the map is drawn with; empty draws a plain ground (no connection). */
    styleUrl: string | object
    background: string
    backgrounds: string[]
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
    group: false,
    minZoom: 0,
    maxZoom: 18,
    problem: null,
    height: 400,
    cardState: 'ready',
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
}>()

const phone = Platform.isPhone
const mapEl = ref<HTMLElement>()
const map = shallowRef<MapLibreMap | null>(null)
const selected = ref<string | null>(null)
const hovered = ref<string | null>(null)
const card = shallowRef<MapPlace | null>(null)
const paneCard = shallowRef<MapPlace | null>(null)
const viewer = shallowRef<{ images: ViewerImage[]; index: number; path: string } | null>(null)
const listShown = computed(() => !!props.list)
const sortFrom = ref<MapSortFrom>('centre')
const sortCentre = ref<{ lat: number; lon: number } | null>(null)
const stale = ref(false)
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

const noMap = computed(() => props.problem === 'no-webgl' || props.problem === 'conflict')
const plate = computed(() =>
  plateFor(props.problem, { phone, query: props.searchText, notes: props.skipped.length })
)
const skippedTip = computed(() =>
  props.skipped.length === 1
    ? '1 note is not on the map'
    : `${props.skipped.length} notes are not on the map`
)

// The list's order: the base's own, or nearest first from the person or the map's centre.
const from = computed(() => (sortFrom.value === 'me' ? props.me : sortCentre.value) ?? null)
const distances = computed<Record<string, string>>(() => {
  // A distance means something from the person, or beside the list sorted from the centre.
  const origin =
    props.me && (sortFrom.value !== 'centre' || !listShown.value)
      ? props.me
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
let markers: Marker[] = []
let hoverPopup: Popup | null = null
let hoverTimer = 0
let meMarker: Marker | null = null
let lib: typeof import('maplibre-gl') | null = null

function drawMarks() {
  const m = map.value
  if (!m || !lib) return
  markers.forEach((mk) => mk.remove())
  markers = []
  const doc = mapEl.value!.ownerDocument
  const points = props.places.map((place) => {
    const p = m.project([place.lon, place.lat])
    return { place, x: p.x, y: p.y }
  })
  const atMax = m.getZoom() >= Math.min(props.maxZoom, 18) - 0.01
  const marks = props.group
    ? groupMarks(points, atMax ? 0.5 : 44)
    : points.map((p) => ({ kind: 'place' as const, ...p }))
  for (const mark of marks) {
    if (mark.kind === 'place') {
      const el = pinElement(doc, mark.place)
      el.classList.toggle('is-selected', mark.place.id === selected.value)
      el.classList.toggle('is-hovered', mark.place.id === hovered.value)
      wirePin(el, mark.place)
      markers.push(
        new lib.Marker({ element: el }).setLngLat([mark.place.lon, mark.place.lat]).addTo(m)
      )
    } else {
      const el = groupElement(doc, mark.places.length, mark.sameSpot)
      const ll = m.unproject([mark.x, mark.y])
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        openGroup(mark.places, mark.sameSpot || atMax, el)
      })
      markers.push(new lib.Marker({ element: el }).setLngLat(ll).addTo(m))
    }
  }
}

function wirePin(el: HTMLElement, place: MapPlace) {
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    pressPlace(place, e)
  })
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') pressPlace(place, e as unknown as MouseEvent)
  })
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    placeMenuAt(place, e)
  })
  if (phone) return
  el.addEventListener('mouseenter', () => showHover(place))
  el.addEventListener('mouseleave', hideHoverSoon)
}

/** A press on a mark: Obsidian Maps opens the note; on a phone, and beside the list, the card. */
function pressPlace(place: MapPlace, e?: MouseEvent) {
  if (phone) return openCard(place)
  if (listShown.value) return pickFromList(place)
  emit('open', place, e && Keymap.isModEvent(e) ? 'tab' : 'here')
}

function showHover(place: MapPlace) {
  window.clearTimeout(hoverTimer)
  if (!map.value || !lib) return
  if (!place.properties.some((p) => p.value) && !place.title) return
  hoverPopup?.remove()
  const content = mapEl.value!.ownerDocument.createElement('div')
  renderKit(content, MapPlaceHover, {
    place,
    onOpen: (e: MouseEvent) => emit('open', place, Keymap.isModEvent(e) ? 'tab' : 'here'),
  })
  content.addEventListener('mouseenter', () => window.clearTimeout(hoverTimer))
  content.addEventListener('mouseleave', hideHoverSoon)
  const popup = new lib.Popup({
    closeButton: false,
    closeOnClick: true,
    offset: 18,
    className: 'abele-map-base__hover',
    maxWidth: 'none',
  })
    .setLngLat([place.lon, place.lat])
    .setDOMContent(content)
    .addTo(map.value)
  popup.on('close', () => unrenderKit(content))
  hoverPopup = popup
}

function hideHoverSoon() {
  window.clearTimeout(hoverTimer)
  hoverTimer = window.setTimeout(() => {
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
  return el instanceof Element ? below(el.closest('[role=button], .canvas-control-item') ?? el) : { x: 0, y: 0 }
}

function openGroup(places: MapPlace[], spot: boolean, el: HTMLElement) {
  if (!spot && map.value && lib) {
    const b = new lib.LngLatBounds()
    places.forEach((p) => b.extend([p.lon, p.lat]))
    map.value.fitBounds(b, { padding: 80, maxZoom: props.maxZoom })
    return
  }
  spotMenu(places, (p) => (listShown.value && !phone ? pickFromList(p) : openCard(p))).showAtPosition(
    below(el)
  )
}

function placeMenuAt(place: MapPlace, e: MouseEvent) {
  hoverPopup?.remove()
  placeMenu(place, {
    open: (p, where) => emit('open', p, where),
    card: openCard,
    copy,
    remove: (p) => emit('remove', p),
  }).showAtMouseEvent(e)
}

function mapMenuAt(lat: number, lon: number, x: number, y: number) {
  const zoom = map.value?.getZoom() ?? 12
  mapMenu(lat, lon, zoom, {
    create: () => emit('create', lat, lon),
    copy: () => emit('copied', `${lat.toFixed(5)}, ${lon.toFixed(5)}`),
    centre: () => emit('centre', lat, lon),
    zoom: () => emit('saveZoom', Math.round(zoom)),
  }).showAtPosition({ x, y })
}

function copy(place: MapPlace) {
  emit('copied', `${place.lat}, ${place.lon}`)
}

function openCard(place: MapPlace) {
  hoverPopup?.remove()
  card.value = place
}

function openViewer(place: MapPlace, index: number) {
  const images = (place.photos ?? [])
    .filter((p) => !p.missing)
    .map<ViewerImage>((p) => ({
      url: p.url,
      alt: p.caption ?? '',
      type: 'local',
      path: p.path,
      description: p.caption,
    }))
  viewer.value = { images, index: Math.min(index, images.length - 1), path: place.path }
}

function showOnMap(place: MapPlace) {
  card.value = null
  select(place.id)
  map.value?.flyTo({ center: [place.lon, place.lat], zoom: Math.max(map.value.getZoom(), 15) })
}

function pickFromList(place: MapPlace, e?: MouseEvent) {
  if (e && Keymap.isModEvent(e)) return emit('open', place, 'tab')
  if (phone) return openCard(place)
  select(place.id)
  paneCard.value = place
  const m = map.value
  if (!m) return
  const p = m.project([place.lon, place.lat])
  const c = m.getContainer()
  if (p.x < 40 || p.y < 40 || p.x > c.clientWidth - 40 || p.y > c.clientHeight - 40)
    m.easeTo({ center: [place.lon, place.lat] })
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
  sortMenu(sortFrom.value, !!props.me, (f) => {
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
        .setTitle(`${s.title} · ${s.detail ?? skipWords[s.reason]}`)
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
  lib = await loadMaplibre()
  const m = new lib.Map({
    container: mapEl.value,
    style: props.styleUrl as string,
    // Nothing to fit and no centre set: the whole world, not a point in the ocean at 0, 0.
    center: props.center ? [props.center.lon, props.center.lat] : [10, 30],
    zoom: props.center || props.places.length ? (props.zoom ?? 12) : 1.5,
    minZoom: props.minZoom,
    maxZoom: props.maxZoom,
    cooperativeGestures: !!props.embedded,
    attributionControl: { compact: true },
  })
  map.value = m
  m.addControl(new lib.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
  m.on('load', () =>
    mapEl.value
      ?.querySelector('.maplibregl-ctrl-attrib')
      ?.classList.remove('maplibregl-compact-show')
  )
  m.on('rotate', () => {
    controls.bearing = m.getBearing()
    controls.turned = Math.abs(controls.bearing) > 0.5
  })
  m.on('moveend', () => {
    if (props.group) drawMarks()
    if (sortFrom.value === 'centre' && sortCentre.value) {
      const c = m.getCenter()
      stale.value = distance(sortCentre.value, { lat: c.lat, lon: c.lng }) > 150
    }
  })
  m.on('contextmenu', (e) =>
    mapMenuAt(e.lngLat.lat, e.lngLat.lng, e.originalEvent.clientX, e.originalEvent.clientY)
  )
  wireLongPress(m)
  // The view may have been laid out after the map was made: measure again before fitting.
  m.resize()
  if (!props.center && props.places.length) {
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
  resort()
  drawMarks()
  drawMe()
}

/** A phone has no right press: holding a finger still on the map opens the same menu. */
function wireLongPress(m: MapLibreMap) {
  let timer = 0
  let start: { x: number; y: number } | null = null
  const canvas = m.getCanvasContainer()
  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    start = { x: t.clientX, y: t.clientY }
    timer = window.setTimeout(() => {
      const r = canvas.getBoundingClientRect()
      const ll = m.unproject([start!.x - r.left, start!.y - r.top])
      mapMenuAt(ll.lat, ll.lng, start!.x, start!.y)
    }, 550)
  })
  canvas.addEventListener('touchmove', (e) => {
    const t = e.touches[0]
    if (start && Math.hypot(t.clientX - start.x, t.clientY - start.y) > 8)
      window.clearTimeout(timer)
  })
  canvas.addEventListener('touchend', () => window.clearTimeout(timer))
}

function drawMe() {
  meMarker?.remove()
  meMarker = null
  if (!props.me || !map.value || !lib) return
  const dot = mapEl.value!.ownerDocument.createElement('div')
  dot.className = 'abele-map-base__me'
  meMarker = new lib.Marker({ element: dot })
    .setLngLat([props.me.lon, props.me.lat])
    .addTo(map.value)
}

watch(() => [props.places, props.group], drawMarks)
watch(hovered, drawMarks)
watch(() => props.me, drawMe)
watch(
  () => props.styleUrl,
  (s) => map.value?.setStyle(s as string)
)
// A place gone from the base (a filter, the search) is no longer picked.
watch(
  () => props.places,
  (list) => {
    if (selected.value && !list.some((p) => p.id === selected.value)) {
      selected.value = null
      paneCard.value = null
    }
  }
)
// The list opening or closing changes the map's width: MapLibre is told, the view stays put.
watch(listShown, () => requestAnimationFrame(() => map.value?.resize()))

onMounted(() => void create())
onUnmounted(() => {
  window.clearTimeout(hoverTimer)
  hoverPopup?.remove()
  markers.forEach((m) => m.remove())
  map.value?.remove()
})

defineExpose({
  map,
  openCard,
  select,
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

