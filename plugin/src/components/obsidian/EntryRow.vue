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
          :tooltip="
            more
              ? t('kit.hideDetail', { label: moreLabel })
              : t('kit.showDetail', { label: moreLabel })
          "
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
import { t } from '@/i18n'
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
  { more: undefined, moreLabel: () => t('kit.description') }
)
const emit = defineEmits<{ 'update:more': [open: boolean] }>()
</script>

<style lang="scss">
.abele-entry-row {
  container-type: inline-size;
  display: flex;
  align-items: flex-start;
  gap: var(--size-2-3);
  // Only the light's own edge around the words; the room between entries is their margin.
  padding: var(--size-2-2) var(--size-2-3);
  border-radius: var(--radius-s);
  line-height: var(--line-height-normal);

  // Under a group's heading the first entry's words are as far from it as the entries' words are
  // from each other: the margin between entries and the light's edge of one of them.
  .abele-group-heading + & {
    margin-top: var(--abele-entry-heading-gap);
  }

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

  // Entries stand apart by a margin, not by room inside their light, so two lit rows never run
  // together and the light stays close around the words. No line between them: the task list's
  // space alone, the same everywhere.
  & + & {
    margin-top: var(--abele-entry-gap);
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
  align-self: baseline;
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
  // On the name's baseline: a smaller time beside a name reads as one line, as in a mail list.
  align-self: baseline;
  padding-inline-start: var(--size-4-2);
  // A fact at the end, a time or a sum: a size smaller and muted, so it never reads as part of the
  // name. Set on the cell itself, so bare text in it takes it too, not only tags.
  color: var(--abele-text-fact-color);
  font-size: var(--abele-text-fact-size);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  &:empty {
    display: none;
  }

  // A glyph before a code's words has no baseline of its own, so its bottom stood on the name's
  // and the glyph rode above the line where glyphs are larger, on a phone: the words give the
  // baseline and the glyph stands in the middle of their line, lifted by the step a smaller
  // size on the name's baseline sits lower than the name's middle.
  .abele-obsidian-icon:not(.clickable-icon) {
    height: auto;
    padding: 0;
    align-items: baseline;
  }
  // Interactive codes keep the host's whole hover and touch box on the code's line.
  .abele-obsidian-icon.clickable-icon {
    margin-block: calc(-1 * var(--size-2-2));
  }
  .abele-obsidian-icon:not(.clickable-icon) .abele-obsidian-icon__icon {
    align-self: center;
    position: relative;
    top: calc(-1 * var(--size-2-1));
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
  color: var(--abele-text-meta-color);
  font-size: var(--abele-text-meta-size);
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

// Where there is a pointer, what can be done to the row takes the place of its fact at the end of
// the name's line while the row is under the pointer or the keyboard: the time goes, the glyph comes,
// in the same spot. The cell keeps the width of the wider of the two, so nothing moves.
@media (hover: hover) {
  body:not(.is-phone) {
    .abele-entry-row__aside {
      grid-area: codes;
      justify-self: end;
      align-self: center;
      height: calc(var(--line-height-normal) * 1em);
      margin-top: 0;
      padding-inline-start: var(--size-4-2);
    }
    .abele-entry-row:is(:hover, :focus-within)
      .abele-entry-row__body:has(> .abele-entry-row__aside)
      > .abele-entry-row__codes {
      visibility: hidden;
    }
  }
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
  .abele-entry-row__aside {
    align-self: center;
  }

  .abele-entry-row__codes {
    height: auto;
    // On the quiet line, the size of its words.
    font-size: var(--abele-text-meta-size);
    margin-top: var(--size-2-1);
    padding-inline: 0 var(--size-4-2);
  }
}
</style>
