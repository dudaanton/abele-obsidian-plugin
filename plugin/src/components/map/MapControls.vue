<template>
  <!-- The map's glyphs as the canvas floats its own: Obsidian Canvas's control column. -->
  <div ref="controlsEl" class="canvas-controls abele-map-controls">
    <div class="canvas-control-group">
      <ControlItem icon="plus" :tooltip="t('maps.zoomIn')" @click="emit('zoom', 1)" />
      <ControlItem icon="minus" :tooltip="t('maps.zoomOut')" @click="emit('zoom', -1)" />
    </div>
    <div class="canvas-control-group">
      <!-- Only once the map is turned or tilted: the way back to north up. -->
      <ControlItem
        v-if="state.turned"
        class="abele-map-controls__north"
        :style="{ '--abele-map-bearing': `${-state.bearing}deg` }"
        icon="navigation-2"
        :tooltip="t('maps.north')"
        @click="emit('north')"
      />
      <ControlItem
        :class="{ 'is-active': state.following }"
        :icon="state.locationOff ? 'locate-off' : 'locate-fixed'"
        :tooltip="locateTip"
        :disabled="state.locating"
        @click="emit('locate')"
      />
      <ControlItem v-if="fit" icon="scan" :tooltip="t('maps.fitPlaces')" @click="emit('fit')" />
      <ControlItem
        v-if="fullscreenSupported"
        :icon="state.full ? 'minimize' : 'maximize'"
        :tooltip="state.full ? t('maps.exitFull') : t('maps.full')"
        @click="emit('full')"
      />
    </div>
    <!-- A base's map: which background it is drawn on. -->
    <div v-if="layers" class="canvas-control-group">
      <ControlItem
        icon="layers"
        :tooltip="t('maps.background')"
        @click="(e: MouseEvent) => emit('layers', e)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// What a map in a note or a chat offers to do, in the plugin's glyphs with words in tooltips:
// zoom, back to north once turned, where the device is, and the whole screen.
import { computed, onMounted, ref } from 'vue'
import { ControlItem } from '../obsidian/ControlItem'
import type { MapControlsState } from './mapControlsState'

const props = defineProps<{ state: MapControlsState; layers?: boolean; fit?: boolean }>()
const controlsEl = ref<HTMLElement>()
const fullscreenSupported = ref(false)
onMounted(() => {
  fullscreenSupported.value = typeof controlsEl.value?.requestFullscreen === 'function'
})
const locateTip = computed(() =>
  props.state.locating
    ? t('maps.locating')
    : props.state.locationOff
      ? t('maps.locationOff')
      : props.state.following
        ? t('maps.following')
        : t('maps.showLocation')
)
const emit = defineEmits<{
  zoom: [step: 1 | -1]
  north: []
  locate: []
  full: []
  fit: []
  layers: [event: MouseEvent]
}>()
</script>

<style lang="scss">
// Inside the map's own corner, not the canvas's: MapLibre places it, the column keeps its look.
// MapLibre's own corner margin on the host is dropped: the column keeps the same distance from
// the map's edge as the scale and the source's glyph in the other corners.
.maplibregl-ctrl.abele-map-controls-host {
  margin: 0;
}
.abele-map-controls-host > .abele-map-controls {
  position: static;
  margin: var(--size-4-2);
  pointer-events: auto;
}
/* Following the person: the glyph in the accent, as Obsidian marks a toggle that is on. */
.abele-map-controls .canvas-control-item.is-active {
  color: var(--interactive-accent);
}
.abele-map-controls__north svg {
  transform: rotate(var(--abele-map-bearing, 0deg));
}
</style>
