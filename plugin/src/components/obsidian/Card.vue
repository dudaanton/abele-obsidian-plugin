<template>
  <div
    class="abele-card"
    :class="{
      'abele-card_clickable': clickable,
      'abele-card_selected': selected,
      'abele-card_large': large,
    }"
    :aria-pressed="selected === undefined ? undefined : selected"
    :role="clickable ? 'button' : undefined"
    :tabindex="clickable ? 0 : undefined"
    @click="clickable && emit('click')"
    @keydown.enter.prevent="clickable && emit('click')"
  >
    <div v-if="cover" class="abele-card__cover">
      <Image :src="cover" :alt="title" fit="cover" class="abele-card__cover-image" />
    </div>
    <div class="abele-card__head">
      <div class="abele-card__title">
        <span class="abele-card__name">{{ title }}</span>
        <slot name="badges" />
      </div>
      <!-- Actions sit inside a clickable card, so their clicks must not also open it. -->
      <div v-if="$slots.actions" class="abele-card__actions" @click.stop @keydown.enter.stop>
        <slot name="actions" />
      </div>
    </div>

    <div v-if="subtitle" class="abele-card__subtitle">{{ subtitle }}</div>
    <div
      v-if="description"
      class="abele-card__description"
      :class="{ 'abele-card__description_clamped': clampDescription }"
    >
      {{ description }}
    </div>

    <div v-if="meta?.length" class="abele-card__meta">
      <span v-for="entry in meta" :key="entry">{{ entry }}</span>
    </div>

    <slot />
  </div>
</template>

<script setup lang="ts">
/**
 * `selected` is given an explicit `undefined` default: Vue otherwise casts an absent boolean
 * prop to `false`, and a card nobody is choosing between would then announce itself as an
 * unpressed button to anyone using a screen reader.
 */
import Image from './Image.vue'

withDefaults(
  defineProps<{
    title: string
    /** A picture across the top, edge to edge: a note's cover, a poster, a photo in a feed. Vault path, link name or URL. */
    cover?: string
    /** For a card that is the thing itself rather than one of a grid — a post in a feed. The title is a heading. */
    large?: boolean
    /** A secondary identifier — a model id, a path. Rendered in the monospace face. */
    subtitle?: string
    description?: string
    /** Short facts about the item, shown as one faint row. */
    meta?: string[]
    /** Cuts the description at two lines, for a list where one long card buries the next. */
    clampDescription?: boolean
    clickable?: boolean
    /** For a card that is one of several being picked from. */
    selected?: boolean
  }>(),
  {
    cover: undefined,
    subtitle: undefined,
    description: undefined,
    meta: undefined,
    selected: undefined,
  }
)

const emit = defineEmits<{
  (e: 'click'): void
}>()
</script>

<style lang="scss">
.abele-card {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
  padding: var(--size-4-3);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
}

.abele-card_clickable {
  cursor: var(--cursor-link);
  transition: border-color 0.15s;

  &:hover {
    border-color: var(--interactive-accent);
  }
}

/**
 * Chosen, rather than hovered: the accent is what the theme uses to say "this one", and the
 * tint keeps a selected card legible in a grid where the border alone is easy to miss.
 */
.abele-card_selected {
  border-color: var(--interactive-accent);
  background-color: var(--background-modifier-hover);
}

/**
 * Edge to edge, above the padded content: the negative margins undo the card's padding, and
 * the top corners follow the card's own radius so the picture does not poke out of it.
 */
.abele-card__cover {
  margin: calc(-1 * var(--size-4-3)) calc(-1 * var(--size-4-3)) var(--size-4-2);
  overflow: hidden;
  border-radius: var(--radius-m) var(--radius-m) 0 0;
}

.abele-card__cover-image {
  max-height: 60vh;
  border-radius: 0;
}

.abele-card_large .abele-card__name {
  font-size: var(--font-ui-large);
  line-height: var(--line-height-tight);
}

.abele-card_large .abele-card__description {
  font-size: var(--font-ui-medium);
  color: var(--text-normal);
}

/** Wraps rather than pushing the actions off the edge when the card is phone-width. */
.abele-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--size-2-2) var(--size-4-2);
  min-width: 0;
}

.abele-card__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-2-2);
  flex: 1 1 auto;
  min-width: 0;
}

.abele-card__name {
  font-weight: var(--font-semibold);
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}

.abele-card__actions {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  flex: 0 0 auto;
}

.abele-card__subtitle {
  font-family: var(--font-monospace);
  font-size: var(--font-smallest);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.abele-card__description {
  font-size: var(--font-small);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

/** Two lines, then an ellipsis: a card in a list is a summary, not the thing itself. */
.abele-card__description_clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.abele-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-1) var(--size-4-2);
  margin-top: var(--size-2-1);
  font-size: var(--font-smallest);
  color: var(--text-faint);
}
</style>
