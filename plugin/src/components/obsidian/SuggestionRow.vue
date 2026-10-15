<template>
  <div v-if="icon || swatch" class="suggestion-icon">
    <span v-if="icon" ref="iconEl" class="suggestion-flair" />
    <span v-else class="abele-suggestion-row__swatch" :style="{ backgroundColor: swatch }" />
  </div>
  <div class="suggestion-content">
    <div class="suggestion-title" :class="titleClass">{{ title }}</div>
    <div v-if="note !== undefined && (note || keepNote)" class="suggestion-note" :class="noteClass">
      {{ note }}
    </div>
  </div>
  <div v-if="aux?.length || $slots.aux" class="suggestion-aux">
    <template v-for="(item, i) in aux" :key="i">
      <kbd v-if="'kbd' in item" class="suggestion-hotkey">{{ item.kbd }}</kbd>
      <span v-else-if="'flair' in item" class="suggestion-flair" :class="item.cls">{{
        item.flair
      }}</span>
      <span v-else ref="dotEls" :class="item.cls" :data-tooltip="item.dot" />
    </template>
    <slot name="aux" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { setIcon, setTooltip } from 'obsidian'
import type { SuggestionAux } from './suggestionRows'

/**
 * One row of an Obsidian picker, in Obsidian's own markup: `suggestion-icon`, `suggestion-content`
 * with its title and note, `suggestion-aux` with a hotkey, a flair or a dot. Rendered into the
 * element `renderSuggestion` is handed, through `SuggestionRows`, once per row per keystroke —
 * so it stays flat: props only, no store, no watchers.
 */
const props = defineProps<{
  /** A Lucide icon before the text. */
  icon?: string
  /** A colour swatch in the icon's place. */
  swatch?: string
  title: string
  note?: string
  /** Draws the note line even when it is empty, for rows that keep one height. */
  keepNote?: boolean
  titleClass?: string
  noteClass?: string
  aux?: SuggestionAux[]
}>()

const iconEl = ref<HTMLElement>()
const dotEls = ref<HTMLElement[]>([])

onMounted(() => {
  if (iconEl.value && props.icon) setIcon(iconEl.value, props.icon)
  for (const dot of dotEls.value) {
    const tip = dot.dataset.tooltip
    delete dot.dataset.tooltip
    if (tip) setTooltip(dot, tip)
  }
})
</script>

<style>
.abele-suggestion-row__swatch {
  display: inline-block;
  width: 16px;
  height: 16px;
  border-radius: var(--radius-s);
}
</style>
