<template>
  <div class="abele-book-highlights">
    <!-- How many, then what to show and the note they are kept in, as glyphs. -->
    <div
      v-if="highlights.length"
      class="abele-book-highlights__head"
      @click.capture="noteClick = $event"
    >
      <span class="abele-book-highlights__count">{{ shown.length }}</span>
      <Icon
        v-if="discussions.length"
        class="abele-book-highlights__filter"
        icon="list-filter"
        :active="show !== 'all'"
        :tooltip="`Show: ${showOptions.find((o) => o.value === show)!.display.toLowerCase()}`"
        @click="openShowMenu"
      />
      <Icon
        class="abele-book-highlights__note"
        icon="file-text"
        tooltip="Open the note these highlights are kept in"
        @click="emit('open-note', noteClick ?? undefined)"
      />
    </div>
    <div class="abele-book-highlights__list">
      <EmptyState
        v-if="!highlights.length"
        text="No highlights yet. Select words on the page and pick a colour."
      />
      <!-- A highlight as it is in the book: its words marked in its colour, where it is under them. -->
      <EntryRow
        v-for="h in shown"
        :key="h.cfi"
        class="abele-book-highlights__item"
        :class="
          h.discussion && h.plain
            ? 'abele-book-highlights__item_discussion'
            : `abele-book-highlights__item_${h.color}`
        "
        role="button"
        tabindex="0"
        @click="emit('go', h)"
        @keydown.enter.prevent="emit('go', h)"
      >
        <span class="abele-book-highlights__text"
          ><mark class="abele-book-highlights__mark">{{ shortText(h.text) }}</mark></span
        >
        <template #meta>
          <span class="abele-book-highlights__label">{{ h.label }}</span>
        </template>
        <template v-if="h.discussion" #aside>
          <Icon
            icon="messages-square"
            tooltip="Open the discussion about these words"
            @click.stop="emit('discuss', h)"
          />
        </template>
        <template v-if="h.comment" #detail>
          <div class="abele-book-highlights__comment">{{ shortText(h.comment, 200) }}</div>
        </template>
      </EntryRow>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A book's highlights, in the book's order, as its highlights note keeps them — discussions with
 * them, each with the way back into its chat, and a choice to see only one kind or the other.
 */
import { computed, ref } from 'vue'
import EmptyState from '../obsidian/EmptyState.vue'
import Icon from '../obsidian/Icon.vue'
import EntryRow from '../obsidian/EntryRow.vue'
import { Menu } from 'obsidian'
import { shortText } from '@/reader/model'
import type { Highlight } from '@/reader/highlights'

const props = defineProps<{
  highlights: Highlight[]
}>()

const emit = defineEmits<{
  (e: 'go', h: Highlight): void
  (e: 'discuss', h: Highlight): void
  (e: 'open-note', evt?: MouseEvent): void
}>()

const show = ref('all')
const noteClick = ref<MouseEvent | null>(null)
const showOptions = [
  { value: 'all', display: 'Highlights and discussions' },
  { value: 'discussions', display: 'Discussions' },
  { value: 'highlights', display: 'Highlights' },
]
// The choice of what to show, as Obsidian's own menu with the current one ticked.
const openShowMenu = (event: MouseEvent) => {
  const menu = new Menu()
  for (const option of showOptions)
    menu.addItem((item) =>
      item
        .setTitle(option.display)
        .setChecked(show.value === option.value)
        .onClick(() => (show.value = option.value))
    )
  menu.showAtMouseEvent(event)
}
const discussions = computed(() => props.highlights.filter((h) => h.discussion))
const shown = computed(() =>
  show.value === 'discussions'
    ? discussions.value
    : show.value === 'highlights'
      ? props.highlights.filter((h) => !h.plain)
      : props.highlights
)
</script>

<style lang="scss">
.abele-book-highlights {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;

  &__list {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
    padding: var(--size-4-2);
  }

  &__item {
    &_discussion {
      --abele-highlight-color: var(--interactive-accent);
    }

    @each $c in yellow, green, blue, pink, purple, orange {
      &_#{$c} {
        --abele-highlight-color: var(--color-#{$c});
      }
    }
  }

  &__text {
    font-size: var(--font-ui-small);
  }

  // The words marked as the book marks them, the colour carried along every wrapped line.
  // Its colour reaches past the first letter by its own padding, as a row's light does, so the
  // words, not the colour, start where the chapter under them starts.
  &__mark {
    padding: 0 var(--size-2-1);
    margin-inline-start: calc(-1 * var(--size-2-1));
    border-radius: var(--radius-s);
    background-color: color-mix(
      in srgb,
      var(--abele-highlight-color, var(--color-yellow)) 30%,
      transparent
    );
    color: var(--text-normal);
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
  }

  &__comment {
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    font-style: italic;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    padding: var(--size-4-1) var(--size-4-2) 0;
  }

  // The count starts where the panel's glyphs and the rows' words start.
  &__count {
    flex: 1;
    padding-inline-start: var(--size-2-3);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }
}
</style>
