<template>
  <nav
    class="abele-breadcrumbs"
    :class="{ 'abele-breadcrumbs_folded': folded }"
    aria-label="Where this is"
  >
    <template v-for="(entry, at) in shown" :key="entry.index ?? 'more'">
      <Icon v-if="at > 0" icon="chevron-right" no-hover class="abele-breadcrumbs__separator" />
      <span
        v-if="entry.index === null"
        :ref="(el) => applyTooltip(el, 'Show every level')"
        class="abele-breadcrumbs__more"
        role="button"
        tabindex="0"
        @click="open = true"
        @keydown.enter.prevent="open = true"
        @keydown.space.prevent="open = true"
        >…</span
      >
      <span
        v-else-if="entry.index === items.length - 1"
        class="abele-breadcrumbs__item abele-breadcrumbs__item_current"
        aria-current="page"
        >{{ entry.item.label }}</span
      >
      <span
        v-else
        :ref="(el) => applyTooltip(el, entry.item.tooltip)"
        class="abele-breadcrumbs__item"
        role="button"
        tabindex="0"
        @click="emit('select', entry.index)"
        @keydown.enter.prevent="emit('select', entry.index)"
        @keydown.space.prevent="emit('select', entry.index)"
        >{{ entry.item.label }}</span
      >
    </template>
  </nav>
</template>

<script setup lang="ts">
import { computed, ref, watch, type ComponentPublicInstance } from 'vue'
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

const props = defineProps<{
  /** Outermost first; the last is where you are. */
  items: Crumb[]
}>()

/** Above this many levels the middle ones fold into an ellipsis, on one row. */
const FOLD_ABOVE = 3

/** Opened by pressing the ellipsis; folded again whenever a different trail arrives. */
const open = ref(false)
watch(
  () => props.items,
  () => (open.value = false)
)

const folded = computed(() => !open.value && props.items.length > FOLD_ABOVE)

/**
 * What is drawn: every level, or — folded — the root, the ellipsis (`index: null`), the level
 * above where you are and where you are. Each keeps its place in the whole trail, which is what
 * `select` reports.
 */
const shown = computed<Array<{ index: number | null; item: Crumb }>>(() => {
  const all = props.items.map((item, index) => ({ index: index as number | null, item }))
  if (!folded.value) return all
  const last = all.length - 1
  return [all[0], { index: null, item: { label: '…' } }, all[last - 1], all[last]]
})

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
 * takes a second row instead of reaching past the edge. Deeper than three levels it folds its
 * middle into an ellipsis and keeps to one row, every level giving up width rather than wrapping;
 * the ellipsis opens the whole trail again.
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

.abele-breadcrumbs_folded {
  flex-wrap: nowrap;

  // One row, never wrapped: the root and the parent are each held to under a quarter of it and
  // keep that, so neither is crushed to a letter; where you are takes the rest and is the one
  // that gives way.
  .abele-breadcrumbs__item[role='button'] {
    flex-shrink: 0;
    max-width: 22%;
  }

  .abele-breadcrumbs__item_current {
    min-width: 0;
  }
}

.abele-breadcrumbs__more {
  flex: 0 0 auto;
  border-radius: var(--radius-s);
  padding: var(--size-2-1) var(--size-2-2);
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
