<template>
  <nav class="abele-breadcrumbs" aria-label="Where this is">
    <template v-for="(item, index) in items" :key="index">
      <Icon v-if="index > 0" icon="chevron-right" no-hover class="abele-breadcrumbs__separator" />
      <span
        v-if="index === items.length - 1"
        class="abele-breadcrumbs__item abele-breadcrumbs__item_current"
        aria-current="page"
        >{{ item.label }}</span
      >
      <span
        v-else
        :ref="(el) => applyTooltip(el, item.tooltip)"
        class="abele-breadcrumbs__item"
        role="button"
        tabindex="0"
        @click="emit('select', index)"
        @keydown.enter.prevent="emit('select', index)"
        @keydown.space.prevent="emit('select', index)"
        >{{ item.label }}</span
      >
    </template>
  </nav>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from './Icon.vue'

export interface Crumb {
  label: string
  /** What pressing it does. The last one is where you are and is not pressed. */
  tooltip?: string
}

/** Obsidian's own tooltip, as everywhere else in the kit; one element per level. */
function applyTooltip(
  el: Element | ComponentPublicInstance | null,
  tooltip: string | undefined
): void {
  if (el instanceof HTMLElement) setTooltip(el, tooltip ?? '')
}

defineProps<{
  /** Outermost first; the last is where you are. */
  items: Crumb[]
}>()

const emit = defineEmits<{
  (e: 'select', index: number): void
}>()
</script>

<style lang="scss">
/**
 * The way down to where you are, one level per item. The levels are `span`s with a button's
 * role rather than `button`s, for the same reason the kit's tabs are: Obsidian's own
 * `button:not(.clickable-icon)` would dress each one as a grey button.
 *
 * It wraps rather than scrolls, and every level is cut to one line, so a deep trail on a phone
 * takes a second row instead of reaching past the edge.
 */
.abele-breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-1);
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  line-height: var(--line-height-tight);
}

.abele-breadcrumbs__item {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: var(--radius-s);
  padding: var(--size-2-1) var(--size-2-2);
}

.abele-breadcrumbs__item[role='button'] {
  // An ancestor gives up room before where you are does: it is the one you already know.
  max-width: 12em;
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
}

.abele-breadcrumbs__item_current {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--text-normal);
}

.abele-breadcrumbs__separator {
  flex: 0 0 auto;
  color: var(--text-faint);
  --icon-size: var(--icon-xs);
}
</style>
