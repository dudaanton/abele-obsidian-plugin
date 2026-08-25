<template>
  <div class="abele-footnote-card">
    <div class="abele-footnote-card__header">
      <a class="abele-footnote-card__label" @click="scrollToDefinition">[{{ footnote.label }}]</a>
      <div class="abele-footnote-card__actions">
        <a class="abele-footnote-card__action" @click="scrollToReference">↑</a>
        <a class="abele-footnote-card__action abele-footnote-card__delete" @click="remove">✕</a>
      </div>
    </div>
    <Markdown :text="footnote.content" :file-path="footnote.filePath" />
  </div>
</template>

<script setup lang="ts">
import { Footnote } from '@/entities/Footnote'
import { removeFootnote } from '@/commands/footnoteCommands'
import { reliableScrollTo } from '@/helpers/scrollUtils'
import Markdown from './obsidian/Markdown.vue'

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
  padding: var(--size-4-2) var(--size-4-3);
  border-left: 2px solid var(--interactive-accent);
  background-color: var(--background-secondary);
  border-radius: var(--radius-s);
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
  margin-bottom: var(--size-2-2);
}

.abele-footnote-card__label {
  color: var(--text-accent);
  cursor: pointer;
  font-size: var(--font-smaller);
  font-weight: var(--font-semibold);

  &:hover {
    text-decoration: underline;
  }
}

.abele-footnote-card__actions {
  display: flex;
  align-items: center;
  gap: var(--size-2-3);
}

.abele-footnote-card__action {
  color: var(--text-muted);
  cursor: pointer;
  font-size: var(--font-smaller);

  &:hover {
    color: var(--text-accent);
  }
}

.abele-footnote-card__delete:hover {
  color: var(--text-error);
}
</style>
