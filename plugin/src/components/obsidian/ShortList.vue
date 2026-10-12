<template>
  <div class="abele-short-list" :class="{ 'abele-short-list_error': tone === 'error' }">
    <GroupHeading v-if="heading" :label="heading" class="abele-short-list__heading">
      {{ items.length }}
    </GroupHeading>
    <div class="abele-short-list__rows" role="list">
      <!-- A thing a line: its name, and faint after it where it is; an error leads with its mark. -->
      <TreeItem
        v-for="(item, i) in shown"
        :key="i"
        :text="item.title"
        :note="item.meta"
        plain
        flush
        role="listitem"
        class="abele-short-list__row"
      >
        <template v-if="tone === 'error'" #leading>
          <ResultMark state="error" :text="item.title" />
        </template>
      </TreeItem>
    </div>
    <Button
      v-if="items.length > shown.length"
      quiet
      class="abele-short-list__more"
      :text="`Show ${items.length - shown.length} more`"
      tooltip="Show the rest of the list"
      @click="all = true"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * A list a window reports rather than works with — what was found, what failed — kept to its
 * first few rows until asked for the rest, so a long report does not push the window's own
 * controls off the screen. Rows are one line each, a title with where it is faint after it; errors carry a red mark.
 */
import { computed, ref } from 'vue'
import Button from './Button.vue'
import TreeItem from './TreeItem.vue'
import GroupHeading from './GroupHeading.vue'
import ResultMark from './ResultMark.vue'

const props = withDefaults(
  defineProps<{
    items: Array<{ title: string; meta?: string }>
    /** "Skipped", "Errors": over the rows, with their number at its end. */
    heading?: string
    tone?: 'plain' | 'error'
    /** How many rows show before "Show N more". */
    limit?: number
  }>(),
  { heading: undefined, tone: 'plain', limit: 5 }
)
const all = ref(false)
const shown = computed(() => (all.value ? props.items : props.items.slice(0, props.limit)))
</script>

<style lang="scss">
.abele-short-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.abele-short-list__heading {
  margin-bottom: var(--size-2-2);
}

.abele-short-list_error .abele-short-list__heading {
  color: var(--text-error);
}

.abele-short-list__rows {
  display: flex;
  flex-direction: column;
}

// Where the window is narrow, the faint part goes under the name rather than cutting it.
.abele-short-list__row .abele-tree-item__inner {
  flex-wrap: wrap;
}

.abele-short-list__row .abele-tree-item__note {
  flex: 1 1 10em;
}

.abele-short-list .abele-short-list__more {
  align-self: flex-start;
  margin-top: var(--size-2-2);
  padding-inline: var(--size-2-3);

  .modal-content & {
    padding-inline: 0;
  }
}
</style>
