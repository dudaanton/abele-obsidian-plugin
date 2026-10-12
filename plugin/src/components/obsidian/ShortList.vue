<template>
  <div class="abele-short-list" :class="{ 'abele-short-list_error': tone === 'error' }">
    <GroupHeading v-if="heading" :label="heading" class="abele-short-list__heading">
      {{ items.length }}
    </GroupHeading>
    <div class="abele-short-list__rows" role="list">
      <EntryRow v-for="(item, i) in shown" :key="i" role="listitem" class="abele-short-list__row">
        <template v-if="tone === 'error'" #leading>
          <ResultMark state="error" :text="item.title" />
        </template>
        <span class="abele-short-list__title">{{ item.title }}</span>
        <template v-if="item.meta" #meta>
          <span>{{ item.meta }}</span>
        </template>
      </EntryRow>
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
 * controls off the screen. Rows are a title and a quiet line under it; errors carry a red mark.
 */
import { computed, ref } from 'vue'
import Button from './Button.vue'
import EntryRow from './EntryRow.vue'
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

.abele-short-list__title {
  overflow-wrap: anywhere;
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
