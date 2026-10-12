<template>
  <div class="abele-entry-row" :class="{ 'is-active': active }">
    <div v-if="$slots.leading" class="abele-entry-row__leading"><slot name="leading" /></div>
    <div class="abele-entry-row__body">
      <div class="abele-entry-row__title"><slot /></div>
      <!-- Codes stand at the end of the first line; when the row is narrow they move under it. -->
      <div v-if="$slots.codes" class="abele-entry-row__codes"><slot name="codes" /></div>
      <!-- Actions take a column of their own, so a button never covers a code or the words. -->
      <div v-if="$slots.actions || more !== undefined" class="abele-entry-row__actions">
        <slot name="actions" />
        <Icon
          v-if="more !== undefined"
          class="abele-entry-row__more"
          :icon="more ? 'chevron-up' : 'chevron-down'"
          :tooltip="more ? `Hide ${moreLabel}` : `Show ${moreLabel}`"
          @click.stop="emit('update:more', !more)"
        />
      </div>
      <div v-if="$slots.meta" class="abele-entry-row__meta"><slot name="meta" /></div>
      <!-- What can be done to the row, at the end of the quiet line: never over the codes. -->
      <div v-if="$slots.aside" class="abele-entry-row__aside"><slot name="aside" /></div>
      <div v-if="$slots.detail" class="abele-entry-row__detail"><slot name="detail" /></div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * One entry of a list in a pane: a task, an event, a bookmark, a highlight. The name on the first
 * line, the codes of its state at the end of that line, a quiet line of facts under it, and the
 * actions in a column of their own. In a narrow pane (a phone's sidebar) the codes join the quiet line, so the name
 * keeps the width. Rows of one list stand apart by a step, so two selected ones never run together.
 *
 * The row's own element takes whatever the caller puts on it — a role, a click, a class.
 */
import Icon from './Icon.vue'

withDefaults(
  defineProps<{
    /** The row stands for what is on screen now. */
    active?: boolean
    /** Left unset there is nothing to unfold; set, a chevron unfolds the detail. */
    more?: boolean
    moreLabel?: string
  }>(),
  { more: undefined, moreLabel: 'description' }
)
const emit = defineEmits<{ 'update:more': [open: boolean] }>()
</script>

<style lang="scss">
.abele-entry-row {
  container-type: inline-size;
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-1);
  padding: var(--size-2-2) var(--size-2-3);
  border-radius: var(--radius-s);
  line-height: var(--line-height-normal);

  &[role='button'],
  &[role='link'] {
    cursor: var(--cursor);
  }

  &[role='button']:hover,
  &[role='link']:hover,
  &:focus-visible {
    background-color: var(--background-modifier-hover);
  }

  &.is-active {
    background-color: var(--nav-item-background-active, var(--background-modifier-hover));
  }

  // Two lit rows never run together into one slab: apart by Obsidian's own 2px.
  & + & {
    margin-top: var(--size-2-1);
  }
}

.abele-entry-row__leading {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  // A check and a file's picture side by side, a step apart.
  gap: var(--size-4-2);
  min-height: calc(var(--line-height-normal) * 1em);
}

.abele-entry-row__body {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  grid-template-areas:
    'title codes actions'
    'meta aside aside'
    'detail detail detail';
  align-items: start;
  overflow-wrap: anywhere;
}

.abele-entry-row__title {
  grid-area: title;
  min-width: 0;
}

.abele-entry-row__codes {
  grid-area: codes;
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  // As tall as the first line of the name, measured in the name's own size, so the codes in
  // their smaller size sit on the middle of that line rather than at its top.
  height: calc(var(--line-height-normal) * 1em);
  padding-inline-start: var(--size-4-2);
  color: var(--text-muted);
  white-space: nowrap;

  > * {
    font-size: var(--font-ui-smaller);
  }

  &:empty {
    display: none;
  }

  .abele-obsidian-icon {
    height: auto;
    padding: 0;
  }

  svg {
    width: var(--icon-xs);
    height: var(--icon-xs);
  }
}

.abele-entry-row__actions {
  grid-area: actions;
  display: flex;
  align-items: center;
  height: calc(var(--line-height-normal) * 1em);
  // Close to the codes it belongs with: the button's own padding is the gap.
  padding-inline-start: 0;

  &:empty {
    display: none;
  }
}

.abele-entry-row__more {
  color: var(--text-muted);
}

// A button's padding above and below made its box taller than the line, so the box sat centred
// and its glyph hung lower than the codes beside it. Only the glyph is centred on the line; the
// padding stays at the sides, where it is what the pointer finds.
.abele-entry-row__actions .clickable-icon,
.abele-entry-row__aside .clickable-icon {
  padding-block: 0;
  height: auto;

  svg {
    width: var(--icon-xs);
    height: var(--icon-xs);
  }
}

.abele-entry-row__meta {
  grid-area: meta;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  line-height: var(--line-height-tight);

  &:empty {
    display: none;
  }
}

.abele-entry-row__aside {
  grid-area: aside;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--size-2-1);
  margin-top: var(--size-2-1);
  // Under the pointer or the keyboard; a phone cannot point, so there it stays.
  visibility: hidden;

  .abele-entry-row:hover &,
  .abele-entry-row:focus-within &,
  .is-phone &,
  &.is-shown {
    visibility: visible;
  }
}

.abele-entry-row__detail {
  grid-area: detail;
  min-width: 0;
  margin-top: var(--size-2-2);
}

// Narrow: the codes leave the name's line and lead the quiet line under it.
@container (max-width: 18em) {
  .abele-entry-row__body {
    grid-template-columns: auto minmax(0, 1fr) auto;
    grid-template-areas:
      'title title actions'
      'codes meta aside'
      'detail detail detail';
  }

  .abele-entry-row__codes {
    height: auto;
    margin-top: var(--size-2-1);
    padding-inline: 0 var(--size-4-2);
  }
}
</style>
