<template>
  <nav class="abele-github-crumbs" aria-label="Where this is in the repository">
    <template v-for="(crumb, i) in crumbs" :key="i">
      <span v-if="i > 0" class="abele-github-crumbs__sep" aria-hidden="true">/</span>
      <!-- A real link, so hovering shows where it goes and a right click offers what a link does. -->
      <a
        v-if="crumb.url"
        class="abele-github-crumbs__link"
        :href="crumb.url"
        @click="follow($event, crumb.url)"
        >{{ crumb.label }}</a
      >
      <span
        v-else
        class="abele-github-crumbs__part"
        :class="{ 'abele-github-crumbs__part_current': i === crumbs.length - 1 }"
        >{{ crumb.label }}</span
      >
    </template>
    <Badge v-if="refLabel" class="abele-github-crumbs__ref" :text="refLabel" />
  </nav>
</template>

<script setup lang="ts">
import type { PaneType } from 'obsidian'
import Badge from '../obsidian/Badge.vue'
import type { Crumb } from '@/github/tree/fileTree'
import { paneForClick } from '@/github/links'

/**
 * `owner / repo / dir / sub / name`, each folder a link to its listing at the version shown, and
 * that version beside it. A plain click follows it in this tab, Mod opens a new tab, Alt the
 * browser — the clicks of any link here.
 */
defineProps<{
  crumbs: Crumb[]
  /** The branch, tag or short commit the place is at. */
  refLabel?: string
}>()

const emit = defineEmits<{
  (e: 'open', url: string, pane: PaneType | false): void
}>()

const follow = (event: MouseEvent, url: string) => {
  // Obsidian's link handling may have taken it already, when links open in tabs.
  if (event.defaultPrevented) return
  event.preventDefault()
  const pane = paneForClick(event, false)
  if (pane === null) window.open(url)
  else emit('open', url, pane)
}
</script>

<style lang="scss">
.abele-github-crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0 var(--size-2-2);
  overflow-wrap: anywhere;

  &__link {
    color: var(--link-external-color);
    text-decoration: none;

    &:hover {
      color: var(--link-external-color-hover);
      text-decoration: underline;
    }
  }

  &__sep {
    color: var(--text-faint);
  }

  &__part {
    color: var(--text-muted);
  }

  &__part_current {
    color: var(--text-normal);
    font-weight: var(--font-semibold);
  }

  &__ref {
    align-self: center;
    margin-inline-start: var(--size-4-1);
    font-weight: var(--font-normal);
  }
}
</style>
