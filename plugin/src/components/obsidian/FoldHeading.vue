<template>
  <div
    class="abele-fold-heading"
    :class="{
      'is-collapsible': collapsible,
      'is-collapsed': collapsible && collapsed,
      'is-disabled': collapsible && disabled,
      'is-inline': collapsible && !hang,
    }"
    :role="collapsible ? 'button' : undefined"
    :tabindex="collapsible && !disabled ? 0 : undefined"
    :aria-expanded="collapsible ? !collapsed : undefined"
    :aria-disabled="collapsible && disabled ? true : undefined"
    @click="collapsible && !disabled && emit('toggle')"
    @keydown="onKey"
  >
    <span
      v-if="collapsible"
      ref="chevron"
      class="collapse-icon abele-fold-heading__arrow"
      :class="{ 'is-collapsed': collapsed }"
      aria-hidden="true"
    />
    <span class="abele-fold-heading__text"
      ><slot name="text">{{ text }}</slot></span
    >
    <span v-if="count !== undefined" class="abele-fold-heading__count">{{ count }}</span>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { setIcon } from 'obsidian'

/**
 * The title of a list that can be folded away: Obsidian's own fold arrow — the one on headings,
 * callouts and the file tree, pointing down while open and right while folded — then the title,
 * then how many entries the list holds. The whole of it is the control and lights up as one under
 * the pointer: a click, Enter or Space asks to toggle. Not `collapsible`, it is the plain title and nothing more.
 */
const props = withDefaults(
  defineProps<{
    text: string
    /** Muted, after the title: how many entries the list holds, folded or not. */
    count?: number
    collapsible?: boolean
    collapsed?: boolean
    /** Seen but cannot be folded now: faint, no light, no tab stop. */
    disabled?: boolean
    /**
     * The arrow hangs in the margin before the title, as over a list whose rows start on the
     * title's edge. Off, it stands inside, on the edge of the words around: a fold in running
     * content (under a quote, in a card) has no margin to hang into.
     */
    hang?: boolean
  }>(),
  { count: undefined, collapsible: false, collapsed: false, disabled: false, hang: true }
)

const emit = defineEmits<{
  /** Asks the owner to fold or unfold; the owner decides and passes `collapsed` back. */
  toggle: []
}>()

const onKey = (e: KeyboardEvent) => {
  if (!props.collapsible || props.disabled || (e.key !== 'Enter' && e.key !== ' ')) return
  // Space would otherwise scroll the note.
  e.preventDefault()
  emit('toggle')
}

const chevron = ref<HTMLElement>()
const draw = () => {
  if (chevron.value && !chevron.value.firstChild) setIcon(chevron.value, 'right-triangle')
}
onMounted(draw)
watch(() => props.collapsible, draw, { flush: 'post' })
</script>

<style lang="scss">
.abele-fold-heading {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);
  min-width: 0;

  // The whole title is the control and lights up as one, as a row of Obsidian's trees and the
  // Backlinks headings do: arrow, words and count together. The room the light needs at the sides
  // is taken back by margins, so the words stay on the edge of the rows under them. Above and below
  // the light is the line's own height: room taken back there would lay it over the row beneath.
  &.is-collapsible {
    cursor: var(--cursor);
    border-radius: var(--radius-s);
    padding: 0 var(--size-2-3);
    margin-inline-end: calc(-1 * var(--size-2-3));

    .abele-fold-heading__arrow {
      color: var(--icon-color);
    }
    &:hover:not(.is-disabled) {
      background-color: var(--background-modifier-hover);

      .abele-fold-heading__arrow {
        color: var(--icon-color-hover);
      }
    }

    // The ring Obsidian draws round its own clickable icons, for whoever arrives by Tab.
    &:focus-visible {
      box-shadow: 0 0 0 var(--size-2-1) var(--background-modifier-border-focus);
      outline: none;
    }
  }
}

.abele-fold-heading.is-disabled {
  color: var(--text-faint);
  cursor: default;
}

// The arrow hangs in the margin before the title, as Obsidian's own fold arrows on headings do,
// so the title starts on the same edge as the rows under it and nothing moves as it folds.
.abele-fold-heading__arrow {
  flex: 0 0 auto;
  // On the first line of a title that wraps, as a tree's arrow stays by its first line.
  align-self: flex-start;
  align-items: center;
  height: 1lh;
  // As wide as the margin the heading is pulled back by, whatever size the theme draws the arrow.
  display: inline-flex;
  justify-content: center;
  width: var(--icon-xs);
}

.abele-fold-heading.is-collapsible {
  margin-inline-start: calc(-1 * (var(--icon-xs) + var(--size-4-1) + var(--size-2-3)));
}
// Standing inside: only the light's own room is taken back, so the arrow is on the words' edge.
.abele-fold-heading.is-collapsible.is-inline {
  margin-inline-start: calc(-1 * var(--size-2-3));
}

// Under a section's heading a list's title is a group's heading, a step below it: never bigger
// than the heading it stands under.
.abele-section > .abele-fold-heading {
  color: var(--abele-text-heading-color);
  font-size: var(--abele-text-heading-size);
  font-weight: var(--abele-text-heading-weight);
}

.abele-fold-heading__count {
  color: var(--abele-text-count-color);
  font-weight: var(--font-normal);
}
</style>
