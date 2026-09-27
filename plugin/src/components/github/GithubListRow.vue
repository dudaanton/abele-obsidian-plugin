<template>
  <div
    class="abele-github-list-row"
    role="listitem"
    tabindex="0"
    :data-url="item.url"
    @click="open"
    @keydown.enter.prevent="open"
  >
    <Icon :icon="glyph.icon" :color="glyph.color" no-hover class="abele-github-list-row__state" />
    <div class="abele-github-list-row__body">
      <div class="abele-github-list-row__title">
        <span class="abele-github-list-row__name">{{ item.title }}</span>
        <Badge v-for="label in item.labels" :key="label.name" :text="label.name" />
      </div>
      <div class="abele-github-list-row__meta">
        #{{ item.number }} · {{ item.state === 'draft' ? 'draft ' : '' }}opened
        {{ formatDate(item.createdAt) }} by {{ item.author
        }}<template v-if="item.category"> · {{ item.category }}</template
        ><template v-if="item.milestone"> · {{ item.milestone }}</template>
      </div>
    </div>
    <span v-if="item.comments" class="abele-github-list-row__comments">
      <Icon icon="message-square" no-hover :text-right="String(item.comments)" />
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { PaneType } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import Badge from '../obsidian/Badge.vue'
import { formatDate } from '@/github/format'
import { paneForClick } from '@/github/links'
import type { ListItem } from '@/github/lists/listData'
import type { KitColor } from '@/constants/colors'

/**
 * One pull request, issue or discussion in a list: its state as GitHub draws it — a glyph in the
 * colour for open, closed, merged or answered — its title and labels, who opened it and when, and
 * how many comments it has. A click opens it by the clicks of any link here.
 */
const props = defineProps<{ item: ListItem }>()

const emit = defineEmits<{
  (e: 'open', url: string, pane: PaneType | false): void
}>()

const GLYPHS: Record<string, { icon: string; color?: KitColor }> = {
  'pull:open': { icon: 'git-pull-request', color: 'green' },
  'pull:draft': { icon: 'git-pull-request-draft', color: 'grey' },
  'pull:merged': { icon: 'git-merge', color: 'purple' },
  'pull:closed': { icon: 'git-pull-request-closed', color: 'red' },
  'issue:open': { icon: 'circle-dot', color: 'green' },
  'issue:closed': { icon: 'circle-check', color: 'purple' },
  'discussion:open': { icon: 'messages-square', color: 'green' },
  'discussion:answered': { icon: 'message-square-check', color: 'green' },
  'discussion:closed': { icon: 'messages-square', color: 'purple' },
}

const glyph = computed(
  () => GLYPHS[`${props.item.kind}:${props.item.state}`] ?? { icon: 'circle-dot' }
)

const open = (event: MouseEvent | KeyboardEvent) => {
  const pane = event instanceof MouseEvent ? paneForClick(event, false) : false
  if (pane === null) window.open(props.item.url)
  else emit('open', props.item.url, pane)
}
</script>

<style lang="scss">
.abele-github-list-row {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3);
  cursor: var(--cursor);
  border-bottom: 1px solid var(--background-modifier-border);

  &:last-child {
    border-bottom: none;
  }

  &:hover,
  &:focus-visible {
    background-color: var(--background-modifier-hover);
  }

  &__state {
    flex: 0 0 auto;
    padding-top: var(--size-2-1);
  }

  &__body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--size-2-1);
  }

  &__title {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-2-2);
  }

  &__name {
    font-weight: var(--font-semibold);
    overflow-wrap: anywhere;
  }

  &__meta {
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    overflow-wrap: anywhere;
  }

  &__comments {
    flex: 0 0 auto;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }
}
</style>
