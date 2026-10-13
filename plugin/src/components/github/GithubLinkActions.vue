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
    <!-- A phone has no room for three glyphs beside a name: one, opening the same three. -->
    <Icon
      class="abele-github-link-actions__more"
      icon="more-horizontal"
      :tooltip="`Link or quote this ${what}`"
      @click="more"
    />
  </span>
</template>

<script setup lang="ts">
import { Menu } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import type { GithubLink } from '@/github/permalinks'
import type { Linker } from '@/github/linking'
import type { SnippetBlock } from '@/github/snippetBlock'

const props = defineProps<{
  linker: Linker
  /** Made when pressed: a link to lines of a file may need to ask GitHub for the commit. */
  link: () => GithubLink | Promise<GithubLink>
  /** What the link points at, for the tooltips: "comment", "review". */
  what: string
  /** The text itself, for a quote card in the note. */
  quote?: () => SnippetBlock
}>()

function more(event: MouseEvent): void {
  const menu = new Menu()
  menu.addItem((i) =>
    i
      .setTitle('Copy link')
      .setIcon('link')
      .onClick(() => props.linker.copy(props.link()))
  )
  menu.addItem((i) =>
    i
      .setTitle('Insert link into the note')
      .setIcon('text-cursor-input')
      .onClick(() => props.linker.insert(props.link()))
  )
  const quote = props.quote
  if (quote)
    menu.addItem((i) =>
      i
        .setTitle('Insert as a quote')
        .setIcon('quote')
        .onClick(() => props.linker.insertSnippet(quote()))
    )
  menu.showAtMouseEvent(event)
}
</script>

<style lang="scss">
.abele-github-link-actions {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
}

.abele-github-link-actions__more,
.is-phone .abele-github-link-actions > :not(.abele-github-link-actions__more) {
  display: none;
}

.is-phone .abele-github-link-actions__more {
  display: flex;
}
</style>
