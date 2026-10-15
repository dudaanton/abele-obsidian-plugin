<template>
  <Icon
    :icon="place === 'setting' ? 'pin-off' : 'pin'"
    :label="label"
    :active="place !== null"
    class="abele-book-script-pin"
    :class="{ 'is-active': place !== null, 'is-disabled': place === 'header' }"
    :data-place="place ?? ''"
    @keydown="onKey"
    @click="toggle"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Notice } from 'obsidian'
import Icon from '@/components/obsidian/Icon.vue'
import { selectionMenuPlace, type SelectionMenuSurface } from './selectionMenuScripts'

/**
 * The pin at the end of a script's row in the selection-script picker: on this surface's menu,
 * off it, or on it by the script's own header and not to be changed here. Pinning changes the
 * menu only; it never runs the script.
 */
const props = defineProps<{
  surface: SelectionMenuSurface
  /** Where the script stands on the menu now, read fresh from the settings. */
  placeOf: () => ReturnType<typeof selectionMenuPlace>
  setOnMenu: (on: boolean) => Promise<void>
}>()

const place = ref(props.placeOf())
const label = computed(() =>
  place.value === 'setting'
    ? `Take it off the ${props.surface} menu`
    : place.value === 'header'
      ? `On the ${props.surface} menu by its header`
      : `Keep it on the ${props.surface} menu`
)

// The native suggestion scope uses Enter to run the selected row. A focused pin owns
// Enter/Space instead, just like its pointer click, and leaves that scope untouched.
function onKey(evt: KeyboardEvent): void {
  if (evt.key !== 'Enter' && evt.key !== ' ') return
  evt.preventDefault()
  evt.stopPropagation()
  ;(evt.currentTarget as HTMLElement).click()
}

function toggle(evt: MouseEvent): void {
  evt.preventDefault()
  evt.stopPropagation()
  const now = props.placeOf()
  if (now === 'header') return
  void props
    .setOnMenu(now !== 'setting')
    .then(() => (place.value = props.placeOf()))
    .catch((error) => new Notice(error instanceof Error ? error.message : String(error)))
}
</script>
