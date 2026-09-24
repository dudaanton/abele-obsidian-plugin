<template>
  <span class="abele-github-link-actions">
    <Icon icon="link" :tooltip="`Copy a link to this ${what}`" @click="linker.copy(link())" />
    <Icon
      icon="text-cursor-input"
      :tooltip="`Insert a link to this ${what} into the note`"
      @click="linker.insert(link())"
    />
    <Icon
      v-if="quote"
      icon="quote"
      :tooltip="`Insert this ${what} into the note as a quote, with its text`"
      @click="linker.insertSnippet(quote())"
    />
  </span>
</template>

<script setup lang="ts">
import Icon from '../obsidian/Icon.vue'
import type { GithubLink } from '@/github/permalinks'
import type { Linker } from '@/github/linking'
import type { SnippetBlock } from '@/github/snippetBlock'

defineProps<{
  linker: Linker
  /** Made when pressed: a link to lines of a file may need to ask GitHub for the commit. */
  link: () => GithubLink | Promise<GithubLink>
  /** What the link points at, for the tooltips: "comment", "review". */
  what: string
  /** The text itself, for a quote card in the note. */
  quote?: () => SnippetBlock
}>()
</script>

<style lang="scss">
.abele-github-link-actions {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
}
</style>
