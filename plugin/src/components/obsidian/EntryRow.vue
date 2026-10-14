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
  gap: var(--size-2-3);
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

  // In a window the words of a row stand at the window's text edge, as in a note: the inset that
  // holds them off the row's light hangs out into the margin.
  .modal-content & {
    margin-inline: calc(-1 * var(--size-2-3));
  }

  // Two lit rows never run together into one slab: apart by Obsidian's own 2px.
  & + & {
    margin-top: var(--size-2-1);
  }

  // Entries end at a hairline, from the words' edge to the row's end, as Obsidian's own group of
  // settings does between rows: whitespace alone ran the line under one name into the name of the
  // next, and in a narrow pane every entry is two lines, its codes under the name. Drawn in the
  // 2px between the rows, under neither one's light.
  & + & {
    position: relative;

    &::before {
      content: '';
      position: absolute;
      top: calc(-1 * var(--size-2-1) / 2);
      inset-inline: var(--size-2-3);
      border-top: 1px solid var(--background-modifier-border);
      pointer-events: none;
    }
  }
}

.abele-entry-row__leading {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  // A check and a file's picture side by side, a step apart.
  gap: var(--size-4-2);

  // A check belongs to its words: Obsidian's own margin after it, added to the row's gap, held it
  // further from them than from the line above the row.
  input[type='checkbox'] {
    margin-inline-end: 0;
  }
  min-height: calc(var(--line-height-normal) * 1em);

  // A check in its label sat on the label's own baseline, above the middle of the words, and in a
  // note's reading view Obsidian's nudge for an inline check pushed it below: the label stands it
  // in the middle of the line by itself, wherever the row is.
  .task-list-label {
    display: flex;
    align-items: center;
  }
  .task-list-label input[type='checkbox'] {
    top: 0;
    margin-block: 0;
  }
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
  // A step from the codes, so the button's box never touches them.
  padding-inline-start: var(--size-2-2);

  &:empty {
    display: none;
  }
}

.abele-entry-row__more {
  color: var(--text-muted);
}

// A button's padding above and below made its box taller than the line, so the box sat centred
// and its glyph hung lower than the codes beside it. Pressing the padding out flattened the button
// against the codes; a negative margin keeps the box whole and the glyph on the line.
.abele-entry-row__actions .clickable-icon,
.abele-entry-row__aside .clickable-icon {
  // The whole box stays — it is what the pointer and the finger find — and its height is taken
  // back by a margin as tall as its padding, so the line does not grow and the glyph stays on it.
  margin-block: calc(-1 * var(--size-2-2));
  // Scrolled to by the keyboard, it stops with room to spare, not flush with the edge; its focus
  // ring is drawn inside the box, so no edge of a scrolling list cuts it.
  scroll-margin-block: var(--size-2-3);

  &:focus-visible {
    box-shadow: inset 0 0 0 var(--size-2-1) var(--background-modifier-border-focus);
  }

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

  // On the quiet line's baseline: codes and words of different sizes still read as one line.
  .abele-entry-row__codes,
  .abele-entry-row__meta {
    align-self: baseline;
  }

  .abele-entry-row__codes {
    height: auto;
    margin-top: var(--size-2-1);
    padding-inline: 0 var(--size-4-2);
  }
}
</style>
