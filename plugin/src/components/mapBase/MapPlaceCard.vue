<template>
  <div :class="['abele-map-card', { 'abele-map-card_pane': pane }]">
    <div class="abele-map-card__head">
      <Icon
        v-if="pane"
        class="abele-map-card__back"
        icon="arrow-left"
        :tooltip="t('maps.backList')"
        @click="emit('back')"
      />
      <PlaceGlyph v-if="status !== 'deleted'" :place="loaded" />
      <div class="abele-map-card__titles">
        <div class="abele-map-card__title">{{ place.title }}</div>
        <MetaLine v-if="facts.length && status === 'ready'" :facts="facts" />
      </div>
    </div>

    <EmptyState
      v-if="status === 'deleted'"
      icon="file-x"
      :title="t('maps.cardGone')"
      :text="t('maps.cardGoneText')"
    />
    <EmptyState
      v-else-if="status === 'error'"
      variant="error"
      icon="file-warning"
      :title="t('maps.cardError')"
      :text="t('maps.cardErrorText')"
    />

    <EmptyState v-else-if="status === 'loading'" icon="loader" :title="t('kit.loading')" />
    <template v-else>
      <div v-if="photos.length" class="abele-map-card__photos" role="list">
        <div
          v-for="(photo, index) in photos"
          :key="`${index}:${photo.path}`"
          class="abele-map-card__photo"
          role="listitem"
        >
          <div
            v-if="photo.missing"
            class="abele-map-card__photo-missing"
            :aria-label="t('maps.imageMissing', { path: photo.path })"
          >
            <Icon
              icon="image-off"
              no-hover
              :tooltip="t('maps.imageMissing', { path: photo.path })"
            />
          </div>
          <img
            v-else
            :src="photo.url"
            :alt="photo.caption || ''"
            tabindex="0"
            role="button"
            :aria-label="t('maps.openPicture', { caption: photo.caption || place.title })"
            @error="failed = new Set([...failed, photo.url])"
            @click="emit('photo', index, photos)"
            @keydown.enter.prevent="emit('photo', index, photos)"
          />
        </div>
      </div>

      <div v-if="shown.length" class="abele-map-card__props">
        <template v-for="prop in shown" :key="prop.name">
          <div class="abele-map-card__prop-name">{{ prop.name }}</div>
          <div class="abele-map-card__prop-value">{{ prop.value }}</div>
        </template>
      </div>

      <Markdown
        v-if="loaded.text"
        class="abele-map-card__text"
        :text="loaded.text"
        :file-path="place.path"
        trusted
        as-document
      />
    </template>

    <Teleport :to="footerHost ?? 'body'" :disabled="!footerHost">
      <div class="abele-map-card__foot">
        <Button
          v-if="status !== 'deleted'"
          :text="t('maps.open')"
          accent
          :block="phone"
          :tooltip="t('maps.openNote')"
          @click="emit('open')"
        />
        <div class="abele-map-card__glyphs">
          <Icon v-if="!pane" icon="map-pin" :tooltip="t('maps.showMap')" @click="emit('show')" />
          <Icon icon="copy" :tooltip="t('maps.copy')" @click="emit('copy')" />
          <Icon
            v-if="status !== 'deleted'"
            icon="more-horizontal"
            :tooltip="t('maps.more')"
            @click="(e: MouseEvent) => emit('menu', e)"
          />
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
// A place as a card: its name, what the view shows about it, the pictures of its galleries and
// the note's text, and the way into the note. On a phone a press on a mark opens it; on a desktop
// it is a mark's menu item, and in the list beside the map it takes the list's place.
import { computed, shallowRef, watch, onBeforeUnmount } from 'vue'
import { t } from '@/i18n'
import Markdown from '../obsidian/Markdown.vue'
import { Platform } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import MetaLine from '../obsidian/MetaLine.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import PlaceGlyph from './PlaceGlyph.vue'
import type { MapPlace, MapPlacePhoto } from './places'

export type CardContent = {
  state: 'ready' | 'deleted' | 'error'
  text?: string
  photos?: MapPlacePhoto[]
}

const props = withDefaults(
  defineProps<{
    place: MapPlace
    distance?: string
    footerHost?: HTMLElement
    /** In the pane beside the map, with the way back to the list. */
    pane?: boolean
    state?: 'ready' | 'deleted' | 'error'
    loadPlace?: (place: MapPlace) => Promise<CardContent>
    contentToken?: number
  }>(),
  {
    state: 'ready',
    distance: undefined,
    footerHost: undefined,
    loadPlace: undefined,
    contentToken: 0,
  }
)
const emit = defineEmits<{
  open: []
  back: []
  show: []
  copy: []
  photo: [index: number, photos: MapPlacePhoto[]]
  menu: [event: MouseEvent]
}>()

const phone = Platform.isPhone
const failed = shallowRef(new Set<string>())
const content = shallowRef<CardContent | null>(null)
const pending = shallowRef(false)
let generation = 0
watch(
  () => [props.place, props.contentToken, props.loadPlace],
  async () => {
    const mine = ++generation
    failed.value = new Set()
    if (!props.loadPlace) {
      content.value = null
      pending.value = false
      return
    }
    pending.value = true
    try {
      const result = await props.loadPlace(props.place)
      if (mine === generation) content.value = result
    } catch {
      if (mine === generation) content.value = { state: 'error' }
    } finally {
      if (mine === generation) pending.value = false
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  generation++
})
const loaded = computed(() => ({ ...props.place, ...content.value }))
const photos = computed(() =>
  (loaded.value.photos ?? []).map((p) => ({ ...p, missing: p.missing || failed.value.has(p.url) }))
)
const status = computed(() => (pending.value ? 'loading' : (content.value?.state ?? props.state)))
// The first property names the place's kind; it goes up beside the distance, the rest below.
const facts = computed(() =>
  [
    { key: '0', value: loaded.value.properties[0]?.value },
    { key: '1', value: props.distance && t('maps.straightLine', { distance: props.distance }) },
  ].filter((f) => f.value)
)
const shown = computed(() => loaded.value.properties.slice(1))
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
