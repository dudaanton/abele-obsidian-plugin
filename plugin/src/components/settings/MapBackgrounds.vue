<template>
  <Setting
    heading
    name="Backgrounds"
    desc="What a base's map can be drawn on, picked from the map's layers glyph. The map style above always comes first."
  />
  <Setting v-for="(bg, index) in backgrounds" :key="bg.id" :name="bg.name" :desc="summary(bg)">
    <Icon icon="arrow-up" tooltip="Move up" :disabled="index === 0" @click="move(index, -1)" />
    <Icon
      icon="arrow-down"
      tooltip="Move down"
      :disabled="index === backgrounds.length - 1"
      @click="move(index, 1)"
    />
    <Icon icon="pencil" tooltip="Edit" @click="emit('edit', bg)" />
    <Icon icon="trash-2" tooltip="Delete" @click="emit('remove', bg)" />
  </Setting>
  <Setting
    v-if="!backgrounds.length"
    name="No backgrounds of your own"
    desc="Add a style.json or tile address of any provider."
  />
  <Setting
    name="Add a background"
    desc="A style address, or one or more tile templates drawn as layers."
  >
    <Button text="Add" tooltip="Add a background" @click="emit('add')" />
  </Setting>
  <Setting
    v-if="fromMaps"
    name="Backgrounds of Obsidian Maps"
    :desc="`${fromMaps} found. They are copied here; Obsidian Maps keeps its own.`"
  >
    <Button
      :text="`Copy ${fromMaps}`"
      tooltip="Copy the backgrounds of Obsidian Maps"
      @click="emit('import')"
    />
  </Setting>
</template>

<script setup lang="ts">
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
    ? 'style'
    : urls.length === 1
      ? '1 tile layer'
      : `${urls.length} tile layers`
const summary = (bg: MapBackground) =>
  `${kind(bg.light)} · ${bg.dark.length ? 'light and dark' : 'light only, dark uses it too'}`

function move(index: number, step: -1 | 1) {
  const list = [...props.backgrounds]
  const [bg] = list.splice(index, 1)
  list.splice(index + step, 0, bg)
  emit('reorder', list)
}
</script>
