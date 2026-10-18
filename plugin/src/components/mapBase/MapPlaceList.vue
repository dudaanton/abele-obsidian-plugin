<template>
  <div class="abele-map-list">
    <div class="abele-map-list__head">
      <Icon
        :icon="phone ? 'map' : 'panel-left-close'"
        :tooltip="phone ? t('maps.mapFace') : t('maps.hideList')"
        @click="emit('hide')"
      />
      <div
        class="abele-map-list__sort clickable-icon"
        role="button"
        tabindex="0"
        :aria-label="t('maps.sortLabel', { order: sortWords[sortFrom] })"
        @click="(e: MouseEvent) => emit('sort', e)"
        @keydown.enter.prevent="(e: KeyboardEvent) => emit('sort', e as unknown as MouseEvent)"
      >
        <Icon :icon="sortIcon" no-hover />
        <span class="abele-map-list__sort-label">{{ sortWords[sortFrom] }}</span>
        <Icon icon="chevron-down" no-hover size="xs" />
      </div>
      <Icon
        v-if="stale"
        class="abele-map-list__resort"
        icon="refresh-cw"
        :tooltip="t('maps.resort')"
        @click="emit('resort')"
      />
    </div>

    <MetaLine
      v-if="Object.keys(distances).length"
      class="abele-map-list__distance-hint"
      :facts="[
        {
          key: '0',
          value: t(sortFrom === 'centre' ? 'maps.distanceCentre' : 'maps.distanceMe'),
        },
      ]"
    />

    <div
      v-if="places.length"
      ref="scroller"
      class="abele-map-list__rows"
      role="listbox"
      :aria-label="t('maps.placeCount', { count: places.length })"
    >
      <div
        v-for="place in places"
        :key="place.id"
        class="tree-item abele-map-list__row"
        :data-place="place.id"
      >
        <div
          :class="[
            'tree-item-self',
            'is-clickable',
            'abele-map-list__line',
            { 'is-active': place.id === selected },
          ]"
          role="option"
          tabindex="0"
          :aria-selected="place.id === selected"
          @click="(e: MouseEvent) => emit('select', place, e)"
          @keydown.enter.prevent="emit('select', place)"
          @mouseenter="emit('hover', place.id)"
          @mouseleave="emit('hover', null)"
        >
          <PlaceGlyph :place="place" />
          <div class="tree-item-inner abele-map-list__words">
            <div class="abele-map-list__title">{{ place.title }}</div>
            <div v-if="place.properties[0]" class="abele-map-list__kind">
              {{ place.properties[0].value }}
            </div>
          </div>
          <div v-if="distances[place.id]" class="tree-item-flair-outer">
            <span
              :aria-label="t('maps.straightLine', { distance: distances[place.id] })"
              :title="t('maps.straightLine', { distance: distances[place.id] })"
              class="tree-item-flair abele-map-list__distance"
              >{{ distances[place.id] }}</span
            >
          </div>
        </div>
      </div>
    </div>
    <EmptyState
      v-else
      :variant="searched || filtered ? 'no-matches' : 'empty'"
      :icon="searched || filtered ? 'search-x' : 'map-pin-off'"
      :text="
        filtered ? t('maps.filtered') : searched ? t('maps.listSearchEmpty') : t('maps.listEmpty')
      "
    />
  </div>
</template>

<script setup lang="ts">
// The base's places beside the map, in the base's order or by straight-line distance from the
// person or from the map's centre. A press picks the place on the map too; the map moving does
// not reorder what is being read, it offers to sort again instead.
import { t } from '@/i18n'
import { computed, nextTick, ref, watch } from 'vue'
import { Platform } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import MetaLine from '../obsidian/MetaLine.vue'
import PlaceGlyph from './PlaceGlyph.vue'
import { sortWords, type MapPlace, type MapSortFrom } from './places'

const props = defineProps<{
  places: MapPlace[]
  selected: string | null
  sortFrom: MapSortFrom
  distances: Record<string, string>
  /** The map has moved since the list was sorted from its centre. */
  stale?: boolean
  searched?: boolean
  filtered?: boolean
}>()
const emit = defineEmits<{
  select: [place: MapPlace, event?: MouseEvent]
  hover: [id: string | null]
  sort: [event: MouseEvent]
  resort: []
  hide: []
}>()

const phone = Platform.isPhone
const sortIcon = computed(
  () => ({ base: 'arrow-up-down', me: 'locate-fixed', centre: 'crosshair' })[props.sortFrom]
)
const scroller = ref<HTMLElement>()

// A place picked on the map is brought into view in the list.
watch(
  () => props.selected,
  async (id) => {
    await nextTick()
    scroller.value
      ?.querySelector<HTMLElement>(`[data-place="${CSS.escape(id ?? '')}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }
)
</script>

<style>
.abele-map-list {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.abele-map-list__head {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  padding: var(--size-4-2) var(--size-4-2) var(--size-2-3);
}
.abele-map-list__sort {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;
  font-size: var(--font-ui-small);
  color: var(--text-muted);
}
/* On a phone the finger gets its room round the words without the row growing. */
.is-phone .abele-map-list__sort {
  position: relative;
}
.is-phone .abele-map-list__sort::after {
  content: '';
  position: absolute;
  inset: calc(-1 * var(--size-4-2)) 0;
}
.abele-map-list__sort-label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.abele-map-list__resort {
  margin-inline-start: auto;
}
.abele-map-list__distance-hint {
  padding: 0 var(--size-4-4) var(--size-4-2);
}
.abele-map-list__rows {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 var(--size-4-2) var(--size-4-2);
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
}
.abele-map-list__line.tree-item-self {
  align-items: flex-start;
  gap: var(--size-4-2);
  padding: var(--size-2-3) var(--size-4-2);
  margin-bottom: 0;
}
.abele-map-list__line > .abele-map-base__glyph {
  margin-top: calc((var(--line-height-tight) * var(--font-ui-small) - var(--abele-glyph-size)) / 2);
}
.abele-map-list__words.tree-item-inner {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
  flex: 1;
  white-space: normal;
}
.abele-map-list__title {
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  line-height: var(--line-height-tight);
  overflow-wrap: anywhere;
}
.abele-map-list__kind {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  line-height: var(--line-height-tight);
}
.abele-map-list__line .tree-item-flair-outer {
  align-self: flex-start;
}
.abele-map-list__distance {
  font-variant-numeric: tabular-nums;
}
.abele-map-list > .abele-empty-state {
  margin: var(--size-4-8) var(--size-4-4);
}
/* A narrow desktop pane keeps readable note names beside its map. */
@container (max-width: 240px) {
  .abele-map-list__line.tree-item-self {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    row-gap: var(--size-2-1);
  }
  .abele-map-list__line > .abele-map-base__glyph {
    grid-area: 1 / 1;
  }
  .abele-map-list__line > .abele-map-list__words {
    grid-area: 1 / 2;
    justify-self: stretch;
  }
  .abele-map-list__line .tree-item-flair-outer {
    grid-area: 2 / 2;
    margin: 0;
    justify-self: start;
  }
}
</style>
