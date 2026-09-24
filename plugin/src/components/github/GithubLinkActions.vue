<template>
  <span class="abele-github-link-actions">
    <Icon icon="link" :tooltip="`Copy a link to this ${what}`" @click="linker.copy(link())" />
    <Icon
      icon="text-cursor-input"
      :tooltip="`Insert a link to this ${what} into the note`"
      @click="linker.insert(link())"
    />
  </span>
</template>

<script setup lang="ts">
import Icon from '../obsidian/Icon.vue'
import type { GithubLink } from '@/github/permalinks'
import type { Linker } from '@/github/linking'

defineProps<{
  linker: Linker
  /** Made when pressed: a link to lines of a file may need to ask GitHub for the commit. */
  link: () => GithubLink | Promise<GithubLink>
  /** What the link points at, for the tooltips: "comment", "review". */
  what: string
}>()
</script>

<style lang="scss">
.abele-github-link-actions {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
}
</style>
