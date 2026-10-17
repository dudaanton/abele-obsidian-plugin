<template>
  <div :class="['abele-map-card', { 'abele-map-card_pane': pane }]">
    <div class="abele-map-card__head">
      <Icon
        v-if="pane"
        class="abele-map-card__back"
        icon="arrow-left"
        tooltip="Back to the list"
        @click="emit('back')"
      />
      <PlaceGlyph v-if="state !== 'deleted'" :place="place" />
      <div class="abele-map-card__titles">
        <div class="abele-map-card__title">{{ place.title }}</div>
        <MetaLine v-if="facts.length && state === 'ready'" :facts="facts" />
      </div>
    </div>

    <EmptyState
      v-if="state === 'deleted'"
      icon="file-x"
      title="This note is gone"
      text="It was deleted or moved since the map was drawn."
    />
    <EmptyState
      v-else-if="state === 'error'"
      variant="error"
      icon="file-warning"
      title="The note could not be read"
      text="The map still has the place. Open the note to see what is wrong."
    />

    <template v-else>
      <div v-if="place.photos?.length" class="abele-map-card__photos" role="list">
        <div
          v-for="(photo, index) in place.photos"
          :key="photo.path"
          class="abele-map-card__photo"
          role="listitem"
        >
          <div
            v-if="photo.missing"
            class="abele-map-card__photo-missing"
            :aria-label="`${photo.path} is not in the vault`"
          >
            <Icon icon="image-off" no-hover :tooltip="`${photo.path} is not in the vault`" />
          </div>
          <img
            v-else
            :src="photo.url"
            :alt="photo.caption || ''"
            tabindex="0"
            role="button"
            :aria-label="`Open ${photo.caption || 'the picture'}`"
            @click="emit('photo', index)"
            @keydown.enter.prevent="emit('photo', index)"
          />
        </div>
      </div>

      <div v-if="shown.length" class="abele-map-card__props">
        <template v-for="prop in shown" :key="prop.name">
          <div class="abele-map-card__prop-name">{{ prop.name }}</div>
          <div class="abele-map-card__prop-value">{{ prop.value }}</div>
        </template>
      </div>

      <div v-if="place.text" class="abele-map-card__text markdown-rendered">
        <p v-for="(para, i) in paragraphs" :key="i">{{ para }}</p>
      </div>
    </template>

    <div class="abele-map-card__foot">
      <Button
        v-if="state !== 'deleted'"
        text="Open"
        accent
        :block="phone"
        tooltip="Open the note"
        @click="emit('open')"
      />
      <div class="abele-map-card__glyphs">
        <Icon v-if="!pane" icon="map-pin" tooltip="Show on the map" @click="emit('show')" />
        <Icon icon="copy" tooltip="Copy coordinates" @click="emit('copy')" />
        <Icon
          v-if="state !== 'deleted'"
          icon="more-horizontal"
          tooltip="More"
          @click="(e: MouseEvent) => emit('menu', e)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// A place as a card: its name, what the view shows about it, the pictures of its galleries and
// the note's text, and the way into the note. On a phone a press on a mark opens it; on a desktop
// it is a mark's menu item, and in the list beside the map it takes the list's place.
import { computed } from 'vue'
import { Platform } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import MetaLine from '../obsidian/MetaLine.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import PlaceGlyph from './PlaceGlyph.vue'
import type { MapPlace } from './places'

const props = withDefaults(
  defineProps<{
    place: MapPlace
    distance?: string
    /** In the pane beside the map, with the way back to the list. */
    pane?: boolean
    state?: 'ready' | 'deleted' | 'error'
  }>(),
  { state: 'ready', distance: undefined }
)
const emit = defineEmits<{
  open: []
  back: []
  show: []
  copy: []
  photo: [index: number]
  menu: [event: MouseEvent]
}>()

const phone = Platform.isPhone
// The first property names the place's kind; it goes up beside the distance, the rest below.
const facts = computed(() =>
  [
    { key: '0', value: props.place.properties[0]?.value },
    { key: '1', value: props.distance && `${props.distance} in a straight line` },
  ].filter((f) => f.value)
)
const shown = computed(() => props.place.properties.slice(1))
const paragraphs = computed(() =>
  (props.place.text ?? '')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
)
</script>

<style>
.abele-map-card {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  min-width: 0;
}
.abele-map-card__head {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
}
.abele-map-card__head > .abele-map-base__glyph {
  margin-top: calc((var(--line-height-tight) * var(--font-ui-large) - var(--abele-glyph-size)) / 2);
}
.abele-map-card__back {
  margin: calc(-1 * var(--size-2-2)) 0 0 calc(-1 * var(--size-2-3));
}
.abele-map-card__titles {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
}
.abele-map-card__title {
  font-size: var(--font-ui-large);
  font-weight: var(--font-semibold);
  line-height: var(--line-height-tight);
  color: var(--text-normal);
  overflow-wrap: anywhere;
}
.abele-map-card__photos {
  display: flex;
  gap: var(--size-2-3);
  overflow-x: auto;
  scroll-snap-type: x proximity;
  margin: 0 calc(-1 * var(--size-4-1));
  padding: 0 var(--size-4-1) var(--size-2-1);
}
.abele-map-card__photo {
  flex: none;
  height: calc(var(--size-4-12) * 2.25);
  scroll-snap-align: start;
}
.abele-map-card__photo img {
  display: block;
  height: 100%;
  width: auto;
  max-width: calc(var(--size-4-12) * 4);
  object-fit: cover;
  border-radius: var(--radius-s);
  cursor: var(--cursor-link);
}
.abele-map-card__photo-missing {
  height: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-s);
  background: var(--background-secondary);
  color: var(--text-faint);
}
.abele-map-card__props {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: var(--size-4-4);
  row-gap: var(--size-2-3);
  font-size: var(--font-ui-small);
  line-height: var(--line-height-tight);
}
.abele-map-card__prop-name {
  color: var(--text-muted);
}
.abele-map-card__prop-value {
  color: var(--text-normal);
  overflow-wrap: anywhere;
  user-select: text;
}
.abele-map-card__text {
  font-size: var(--font-text-size);
  color: var(--text-normal);
  user-select: text;
}
.abele-map-card__text p {
  margin: 0 0 var(--p-spacing);
}
.abele-map-card__text p:last-child {
  margin-bottom: 0;
}
.abele-map-card__foot {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}
.abele-map-card__glyphs {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  margin-inline-start: auto;
}
.is-phone .abele-map-card__foot {
  flex-direction: row-reverse;
}
.is-phone .abele-map-card__foot > .abele-obsidian-button {
  flex: 1;
}
.is-phone .abele-map-card__glyphs {
  margin-inline-start: 0;
}
</style>
