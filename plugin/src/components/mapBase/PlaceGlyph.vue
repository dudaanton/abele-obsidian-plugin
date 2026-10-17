<template>
  <span ref="el" aria-hidden="true" />
</template>

<script setup lang="ts">
// A place's disc, small, before its name in a list row or a card's title.
import { onMounted, ref, watch } from 'vue'
import { placeGlyph } from './pins'
import type { MapPlace } from './places'

const props = defineProps<{ place: MapPlace }>()
const el = ref<HTMLElement>()
const draw = () => el.value && placeGlyph(el.value, props.place)
onMounted(draw)
watch(() => [props.place.icon, props.place.color], draw)
</script>
