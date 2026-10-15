<template>
  <strong>{{ title }}</strong>
  <div v-for="(detail, index) in details" :key="index">{{ detail }}</div>
  <div class="abele-map__coordinates">{{ coordinates }}</div>
</template>

<script lang="ts">
/** What the popup over a pressed place says: still looking, what was found, or that nothing was. */
export type PlaceState =
  | { kind: 'loading' }
  | { kind: 'place'; title: string; details: string[] }
  | { kind: 'unavailable' }
</script>

<script setup lang="ts">
// The inside of the popup a pressed place opens on an interactive map, rendered into the
// popup's own element and patched as the lookup goes rather than replaced. Flat and prop-only.
import { computed } from 'vue'

const props = defineProps<{ place: PlaceState; coordinates: string }>()

const title = computed(() =>
  props.place.kind === 'place'
    ? props.place.title
    : props.place.kind === 'loading'
      ? 'Looking up this place…'
      : 'Place details unavailable'
)
const details = computed(() => (props.place.kind === 'place' ? props.place.details : []))
</script>
