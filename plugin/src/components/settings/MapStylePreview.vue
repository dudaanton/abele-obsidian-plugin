<template>
  <!-- The picked style on a still picture of one place, drawn again whenever the choice changes,
       in the group's card as the end of the style's row above it. -->
  <div class="setting-item abele-obsidian-setting abele-map-style-preview">
    <div ref="host" class="abele-map" aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderMap, type MapHandle } from '@/helpers/mapRender'
import { mapStyleUrl, type MapStyleChoice } from '@/helpers/mapStyles'

const props = defineProps<{ choice: MapStyleChoice; url: string }>()

// A city centre with streets, water and a park, so every style shows what it does with each.
const PLACE = { lat: 48.8566, lon: 2.3522 }
const HEIGHT = 160

const host = ref<HTMLElement | null>(null)
let handle: MapHandle | null = null
// Only the newest drawing stays: one still loading when the choice changes is taken down.
let drawing = 0
// Drawn only once scrolled into view: opening the tab neither loads the map nor asks for tiles.
let seen = false
let watcher: IntersectionObserver | null = null

async function draw() {
  const el = host.value
  if (!el || !seen) return
  const mine = ++drawing
  handle?.destroy()
  handle = null
  el.style.height = `${HEIGHT}px`
  const dark = (el.ownerDocument || document).body.classList.contains('theme-dark')
  const next = await renderMap(el, {
    points: [PLACE],
    lines: [],
    center: PLACE,
    zoom: 14,
    height: HEIGHT,
    style: mapStyleUrl(props.choice, props.url, dark),
    interactive: false,
  })
  if (mine === drawing) handle = next
  else next.destroy()
}

watch(
  () => [props.choice, props.url],
  () => void draw()
)
onMounted(() => {
  const el = host.value
  const View = el?.ownerDocument.defaultView?.IntersectionObserver
  if (!el || !View) return
  watcher = new View((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return
    seen = true
    watcher?.disconnect()
    watcher = null
    void draw()
  })
  watcher.observe(el)
})
onBeforeUnmount(() => {
  watcher?.disconnect()
  watcher = null
  drawing++
  handle?.destroy()
  handle = null
})
</script>
