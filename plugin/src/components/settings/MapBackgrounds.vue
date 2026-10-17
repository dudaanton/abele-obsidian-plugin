<template>
  <Setting heading :name="t('maps.backgrounds')" :desc="t('maps.backgroundHint')" />
  <Setting v-for="(bg, index) in backgrounds" :key="bg.id" :name="bg.name" :desc="summary(bg)">
    <Icon
      icon="arrow-up"
      :tooltip="t('maps.up')"
      :disabled="index === 0"
      @click="move(index, -1)"
    />
    <Icon
      icon="arrow-down"
      :tooltip="t('maps.down')"
      :disabled="index === backgrounds.length - 1"
      @click="move(index, 1)"
    />
    <Icon icon="pencil" :tooltip="t('maps.edit')" @click="emit('edit', bg)" />
    <Icon icon="trash-2" :tooltip="t('maps.remove')" @click="emit('remove', bg)" />
  </Setting>
  <Setting
    v-if="!backgrounds.length"
    :name="t('maps.noBackgrounds')"
    :desc="t('maps.addressHint')"
  />
  <Setting class="abele-map-bg-add" :name="t('maps.addBackground')" :desc="t('maps.addressHint')">
    <Button :text="t('maps.add')" :tooltip="t('maps.addBackground')" @click="emit('add')" />
  </Setting>
  <Setting v-if="fromMaps" :name="t('maps.fromMaps')" :desc="t('maps.importHint')">
    <Button
      :text="t('maps.copyBackgrounds')"
      :tooltip="t('maps.copyBackgrounds')"
      @click="emit('import')"
    />
  </Setting>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// The named backgrounds a base's map offers, Obsidian Maps' tile sets: each with light addresses
// and, if it has them, dark ones; moved up and down, edited and deleted in place, and the ones
// Obsidian Maps already has copied over without touching its own.
import Setting from '../obsidian/Setting.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import type { MapBackground } from '../mapBase/places'

const props = defineProps<{ backgrounds: MapBackground[]; fromMaps?: number }>()
const emit = defineEmits<{
  add: []
  edit: [bg: MapBackground]
  remove: [bg: MapBackground]
  import: []
  reorder: [list: MapBackground[]]
}>()

const kind = (urls: string[]) =>
  urls.length === 1 && !urls[0].includes('{z}')
    ? t('maps.style')
    : t('maps.tileLayers', { count: urls.length })
const summary = (bg: MapBackground) =>
  `${kind(bg.light)} · ${bg.dark.length ? t('maps.bothThemes') : t('maps.lightOnly')}`

function move(index: number, step: -1 | 1) {
  const list = [...props.backgrounds]
  const [bg] = list.splice(index, 1)
  list.splice(index + step, 0, bg)
  emit('reorder', list)
}
</script>
