<template>
  <!-- A note in the margin, as a book sets one: its number, its words, and on a pointer the way
       back to where it is cited and the bin. No box: the margin is its frame. -->
  <div class="abele-footnote-card">
    <div class="abele-footnote-card__header">
      <button
        type="button"
        class="abele-footnote-card__label"
        :aria-label="`Footnote ${footnote.label}: go to where it is written`"
        @click="scrollToDefinition"
      >
        {{ footnote.label }}
      </button>
      <div class="abele-footnote-card__actions">
        <Icon icon="arrow-up" tooltip="Back to where it is cited" @click="scrollToReference" />
        <Icon icon="trash-2" tooltip="Delete this footnote" @click="remove" />
      </div>
    </div>
    <Markdown trusted :text="footnote.content" :file-path="footnote.filePath" />
  </div>
</template>

<script setup lang="ts">
import { Footnote } from '@/entities/Footnote'
import { removeFootnote } from '@/commands/footnoteCommands'
import { reliableScrollTo } from '@/helpers/scrollUtils'
import Markdown from './obsidian/Markdown.vue'
import Icon from './obsidian/Icon.vue'

const props = defineProps<{
  footnote: Footnote
}>()

function scrollToDefinition() {
  reliableScrollTo(props.footnote.definitionFrom)
}

function scrollToReference() {
  reliableScrollTo(props.footnote.refFrom)
}

function remove() {
  // Asks the user first; nothing here waits on the answer.
  void removeFootnote(props.footnote.label)
}
</script>

<style lang="scss">
.abele-footnote-card {
  padding-inline-start: var(--size-4-3);
  border-inline-start: 1px solid var(--background-modifier-border);
  color: var(--text-muted);
  font-size: var(--font-small);
  line-height: var(--line-height-tight);

  p {
    margin: 0;
  }

  p + p {
    margin-top: var(--size-4-2);
  }
}

.abele-footnote-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-2-2);
  margin-bottom: var(--size-2-2);
}

.abele-footnote-card .abele-footnote-card__label {
  height: auto;
  padding: 0;
  border: none;
  background: none;
  box-shadow: none;
  color: var(--text-accent);
  font-size: var(--font-smaller);
  font-variant-numeric: tabular-nums;
  cursor: var(--cursor-link);

  &:hover {
    text-decoration: underline;
  }
}

// Shown on a pointer or the keyboard, so the margin stays quiet while reading.
.abele-footnote-card__actions {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  margin-block: calc(-1 * var(--size-2-2));
  opacity: 0;
}

.abele-footnote-card:hover .abele-footnote-card__actions,
.abele-footnote-card__actions:focus-within,
.is-mobile .abele-footnote-card__actions {
  opacity: 1;
}
</style>
