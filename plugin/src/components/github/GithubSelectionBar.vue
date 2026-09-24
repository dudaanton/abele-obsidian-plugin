<template>
  <div class="abele-github-selection">
    <span class="abele-github-selection__label">{{ label }}</span>
    <Button
      text="Copy link"
      icon="link"
      tooltip="Copy a link to these lines"
      @click="linker.copy(link())"
    />
    <Button
      text="Insert into note"
      icon="text-cursor-input"
      tooltip="Insert a link to these lines into the note you were last in"
      @click="linker.insert(link())"
    />
    <Button
      v-if="snippet"
      text="Insert with code"
      icon="file-code"
      tooltip="Insert these lines into the note you were last in, as a card holding the code itself"
      @click="linker.insertSnippet(snippet())"
    />
  </div>
</template>

<script setup lang="ts">
import Button from '../obsidian/Button.vue'
import type { GithubLink } from '@/github/permalinks'
import type { Linker } from '@/github/linking'
import type { SnippetBlock } from '@/github/snippetBlock'

defineProps<{
  linker: Linker
  /** "Lines 10–20". */
  label: string
  link: () => GithubLink | Promise<GithubLink>
  /** The lines with their code, for a card in the note. */
  snippet?: () => SnippetBlock | Promise<SnippetBlock>
}>()
</script>

<style lang="scss">
.abele-github-selection {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
  background: var(--background-secondary);
  border-block: 1px solid var(--background-modifier-border);
  font-family: var(--font-interface);
  font-size: var(--font-ui-small);

  &__label {
    color: var(--text-muted);
    margin-right: auto;
  }
}
</style>
