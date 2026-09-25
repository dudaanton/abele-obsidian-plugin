<template>
  <div
    class="abele-card"
    :class="{
      'abele-card_clickable': clickable,
      'abele-card_selected': selected,
      'abele-card_large': large,
      'abele-card_thumbed': !!thumbnail,
    }"
    :aria-pressed="selected === undefined ? undefined : selected"
    :role="clickable ? 'button' : undefined"
    :tabindex="clickable ? 0 : undefined"
    @click="open"
    @keydown.enter="open"
  >
    <div v-if="cover" class="abele-card__cover">
      <Image :src="cover" :alt="title" fit="cover" class="abele-card__cover-image" />
    </div>
    <Image
      v-if="thumbnail"
      :src="thumbnail"
      fit="cover"
      loading="lazy"
      class="abele-card__thumbnail"
    />
    <div class="abele-card__head">
      <div class="abele-card__title">
        <Icon v-if="icon" :icon="icon" no-hover class="abele-card__icon" />
        <a
          v-if="safeHref"
          class="abele-card__name external-link"
          :href="safeHref"
          target="_blank"
          rel="noopener"
          >{{ title }}</a
        >
        <span v-else class="abele-card__name">{{ title }}</span>
        <slot name="badges" />
      </div>
      <!-- Actions sit inside a clickable card, so their clicks must not also open it. -->
      <div v-if="$slots.actions" class="abele-card__actions" @click.stop @keydown.enter.stop>
        <slot name="actions" />
      </div>
    </div>

    <div v-if="subtitle || $slots.subtitle" class="abele-card__subtitle">
      <slot name="subtitle">{{ subtitle }}</slot>
    </div>
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
import Icon from './Icon.vue'
import { computed } from 'vue'
import { fromControl } from '@/helpers/interactive'

const props = withDefaults(
  defineProps<{
    title: string
    /**
     * Makes the title a link to this address. Clicked, it goes wherever a link in a note goes —
     * the plugin's own tab for one it can show — so the card itself stays unclickable.
     */
    href?: string
    /** A lucide icon before the title — what the item is, at a glance. Decoration, not a control. */
    icon?: string
    /** A picture across the top, edge to edge: a note's cover, a poster, a photo in a feed. Vault path, link name or URL. */
    cover?: string
    /** A small picture on the right, beside the words: a note's cover in a list. Vault path, link name or URL. */
    thumbnail?: string
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
    href: undefined,
    icon: undefined,
    cover: undefined,
    thumbnail: undefined,
    subtitle: undefined,
    description: undefined,
    meta: undefined,
    selected: undefined,
  }
)

const emit = defineEmits<{
  (e: 'click'): void
}>()

/**
 * The title only ever links to a web address. `href` can come from text in a note — a snippet
 * block anyone or any agent may have written — and a `javascript:` address there would run
 * when the title is clicked.
 */
const safeHref = computed(() =>
  props.href && /^https?:\/\//i.test(props.href.trim()) ? props.href.trim() : undefined
)

/**
 * Opens the card — unless the press started on a control inside it. A feed card opens the
 * note, and the Open, Later and Hide buttons under its text are the script's; pressing one
 * must not also open the note. Enter is only claimed for the card itself, so Enter on an
 * inner button stays that button's press.
 */
const open = (event: Event) => {
  if (!props.clickable || fromControl(event)) return
  if (event instanceof KeyboardEvent) event.preventDefault()
  emit('click')
}
</script>

<style lang="scss">
.abele-card {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
  /** So the cover can be capped against the card's own width, whatever the screen. */
  container-type: inline-size;
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
 * The thumbnail is a strip down the right edge, edge to edge like the cover, and the words
 * keep out of it through the padding. Positioned rather than laid out in a column so every
 * other part of the card stays where it is, and so the strip is as tall as whatever the card
 * holds; the minimum height keeps it from being a sliver beside a card of one line.
 */
.abele-card_thumbed {
  position: relative;
  padding-inline-end: calc(var(--size-4-16) + var(--size-4-3));
  min-height: var(--size-4-12);
}

/**
 * Qualified by the card so it outweighs the image's own full width. Decoration beside the
 * title that already names the note, so it carries no `alt` of its own.
 */
.abele-card .abele-card__thumbnail {
  position: absolute;
  inset-block: 0;
  inset-inline-end: 0;
  width: var(--size-4-16);
  height: 100%;
  border-radius: 0 var(--radius-m) var(--radius-m) 0;
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

/**
 * No taller than it is wide. A portrait photo or a phone-shaped poster would otherwise fill
 * the screen and read as a picture with a caption rather than a post with a picture; the
 * viewport is the wrong measure, because on a phone the card *is* the viewport.
 */
.abele-card__cover-image {
  max-height: 100cqw;
  border-radius: 0;
}

.abele-card_large /** Muted, so the name stays what the eye lands on; the glyph only says what kind of thing it is. */
.abele-card__icon {
  flex: 0 0 auto;
  color: var(--text-muted);
}

.abele-card__name {
  font-size: var(--font-ui-large);
  line-height: var(--line-height-tight);
}

.abele-card_large .abele-card__description {
  font-size: var(--font-ui-medium);
  color: var(--text-normal);
}

/** A date or a byline under a heading, not an identifier: the ordinary face, muted. */
.abele-card_large .abele-card__subtitle {
  font-family: inherit;
  font-size: var(--font-ui-small);
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

/**
 * A basis of its own rather than its text's width: a long title then wraps inside its half and
 * leaves the actions on its row. Sized by its text it took the whole row, and a chat's delete
 * icon stood on a line of its own between the title and the summary. A card narrower than the
 * basis and the actions together still wraps them under it.
 */
.abele-card__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-2-2);
  flex: 1 1 12em;
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

/** Line breaks stay: an excerpt of a note reads as its paragraphs, not as one run-on line. */
.abele-card__description {
  font-size: var(--font-small);
  color: var(--text-muted);
  overflow-wrap: anywhere;
  white-space: pre-line;
}

/** Two lines, then an ellipsis: a card in a list is a summary, not the thing itself. */
.abele-card__description_clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

/**
 * Markdown held in a card — a chat message kept in a note — sits flush with the card's padding.
 * Reading-view spacing is for a page: the last paragraph's margin read as an empty line under
 * the text, and the first one's as a gap between the card's head and what it holds.
 */
.abele-card > .abele-markdown {
  > :first-child {
    margin-top: var(--size-4-1);
  }

  > :last-child {
    margin-bottom: 0;
  }
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
