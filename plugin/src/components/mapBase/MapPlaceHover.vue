<template>
  <div class="abele-map-hover">
    <a
      class="internal-link abele-map-hover__title"
      :data-href="place.path"
      :href="place.path"
      @click.prevent="emit('open', $event)"
      >{{ place.title }}</a
    >
    <div v-if="rest.length" class="abele-map-hover__props">
      <template v-for="prop in rest" :key="prop.name">
        <div class="abele-map-hover__name">{{ prop.name }}</div>
        <div class="abele-map-hover__value">{{ prop.value }}</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
// What pointing at a mark shows, as Obsidian Maps shows it: the place's name as a link, then the
// view's chosen properties by their display names. Empty values are not listed; with nothing to
// list, there is no popup at all.
import { computed } from 'vue'
import type { MapPlace } from './places'

const props = defineProps<{ place: MapPlace }>()
const emit = defineEmits<{ open: [event: MouseEvent] }>()
const rest = computed(() => props.place.properties.filter((p) => p.value).slice(0, 19))
</script>

<style>
.abele-map-hover {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
  max-width: calc(var(--size-4-12) * 6);
}
.abele-map-hover__title.internal-link {
  font-weight: var(--font-semibold);
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}
.abele-map-hover__props {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: var(--size-4-3);
  row-gap: var(--size-2-2);
  font-size: var(--font-ui-smaller);
  line-height: var(--line-height-tight);
}
.abele-map-hover__name {
  color: var(--text-muted);
}
.abele-map-hover__value {
  color: var(--text-normal);
  overflow-wrap: anywhere;
}
</style>
