<template>
  <div class="abele-book-highlights">
    <div v-if="discussions.length" class="abele-book-highlights__filter">
      <Dropdown :options="showOptions" :model-value="show" @update:model-value="show = $event" />
    </div>
    <div class="abele-book-highlights__list">
      <EmptyState
        v-if="!highlights.length"
        text="No highlights yet. Select words on the page and pick a colour."
      />
      <div
        v-for="h in shown"
        :key="h.cfi"
        class="abele-book-highlights__item"
        :class="[
          h.discussion && h.plain
            ? 'abele-book-highlights__item_discussion'
            : `abele-book-highlights__item_${h.color}`,
        ]"
        role="button"
        tabindex="0"
        @click="emit('go', h)"
        @keydown.enter.prevent="emit('go', h)"
      >
        <div class="abele-book-highlights__text">{{ shortText(h.text) }}</div>
        <div v-if="h.comment" class="abele-book-highlights__comment">
          {{ shortText(h.comment, 200) }}
        </div>
        <div class="abele-book-highlights__label">
          <span>{{ h.label }}</span>
          <Icon
            v-if="h.discussion"
            icon="messages-square"
            tooltip="Open the discussion about these words"
            @click.stop="emit('discuss', h)"
          />
        </div>
      </div>
    </div>
    <div v-if="highlights.length" class="abele-book-highlights__foot">
      <Button
        text="Open the note"
        icon="file-text"
        tooltip="Open the note these highlights are kept in"
        @click="emit('open-note')"
      />
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
import Dropdown from '../obsidian/Dropdown.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import { shortText } from '@/reader/model'
import type { Highlight } from '@/reader/highlights'

const props = defineProps<{
  highlights: Highlight[]
}>()

const emit = defineEmits<{
  (e: 'go', h: Highlight): void
  (e: 'discuss', h: Highlight): void
  (e: 'open-note'): void
}>()

const show = ref('all')
const showOptions = [
  { value: 'all', display: 'Highlights and discussions' },
  { value: 'discussions', display: 'Discussions' },
  { value: 'highlights', display: 'Highlights' },
]
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
    padding: var(--size-4-2);
  }

  &__item {
    margin-bottom: var(--size-4-2);
    padding: var(--size-4-1) var(--size-4-2);
    border-inline-start: var(--size-2-1) solid var(--abele-highlight-color, var(--color-yellow));
    border-radius: var(--radius-s);
    cursor: var(--cursor);

    &:hover,
    &:focus-visible {
      background-color: var(--background-modifier-hover);
    }

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

  &__comment {
    margin-top: var(--size-4-1);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    font-style: italic;
  }

  &__filter {
    padding: var(--size-4-2) var(--size-4-2) 0;
  }

  &__label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-4-1);
    margin-top: var(--size-4-1);
    font-size: var(--font-ui-smaller);
    color: var(--text-faint);
  }

  &__foot {
    padding: var(--size-4-2);
    border-top: 1px solid var(--background-modifier-border);
  }
}
</style>
