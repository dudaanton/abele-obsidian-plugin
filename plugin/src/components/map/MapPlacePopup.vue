<template>
  <strong>{{ title }}</strong>
  <div v-for="(detail, index) in details" :key="index">{{ detail }}</div>
  <div class="abele-map__coordinates">{{ coordinates }}</div>
</template>

<script setup lang="ts">
// The inside of the popup a pressed place opens on an interactive map, rendered into the
// popup's own element and patched as the lookup goes rather than replaced. Flat and prop-only.
import { computed } from 'vue'
import type { PlaceState } from './placeState'

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
