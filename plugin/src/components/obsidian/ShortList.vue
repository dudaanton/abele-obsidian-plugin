<template>
  <div class="abele-short-list" :class="{ 'abele-short-list_error': tone === 'error' }">
    <!-- How many, right after the words, as a list's count is everywhere: across the window from
         them it read as a sum belonging to nothing. -->
    <GroupHeading v-if="heading" class="abele-short-list__heading">
      <template #label
        >{{ heading }} <span class="abele-short-list__count">{{ items.length }}</span></template
      >
    </GroupHeading>
    <div class="abele-short-list__rows" role="list">
      <!-- A thing a line: its name, and faint after it where it is; an error leads with its mark. -->
      <TreeItem
        v-for="(item, i) in shown"
        :key="i"
        :text="item.title"
        :note="item.meta"
        :icon="tone === 'error' ? undefined : icon"
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
      :text="t('kit.showMore', { count: items.length - shown.length })"
      :tooltip="t('kit.showRest')"
      @click="all = true"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
    /** What every row is, as a glyph ahead of its name: `file`, `square`. */
    icon?: string
  }>(),
  { heading: undefined, tone: 'plain', limit: 5, icon: undefined }
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

// The cross is drawn a little in from its box; set back by that much, its stroke starts on the
// heading's first letter rather than a few pixels after it.
.abele-short-list_error .abele-short-list__row .abele-result-mark {
  margin-inline-start: calc(-0.2 * var(--icon-xs));
}

.abele-short-list__rows {
  display: flex;
  flex-direction: column;
}

// Where it is, or what went wrong, is a quiet line of its own under the name, as under an
// entry's: beside it, a long reason wrapped into a ragged column of its own.
.abele-short-list__row .abele-tree-item__inner {
  flex-wrap: wrap;
  // The quiet line belongs to the name above it: no step between them, the step is between rows.
  row-gap: 0;
}

.abele-short-list__row .abele-tree-item__note {
  flex-basis: 100%;
  color: var(--abele-text-meta-color);
  font-size: var(--abele-text-meta-size);
}

// Under the name, not under the glyph or the mark before it.
.abele-short-list__row .abele-tree-item__glyph:not(:empty) ~ .abele-tree-item__note {
  padding-inline-start: calc(var(--icon-xs) + var(--size-4-1));
}
.abele-short-list_error .abele-short-list__row .abele-tree-item__note {
  padding-inline-start: calc(var(--icon-xs) * 0.8 + var(--size-4-1));
}

.abele-short-list__count {
  color: var(--abele-text-count-color);
  font-weight: var(--font-normal);
}

// A tree's rows are muted all through; here the name is what is read, and where it is stays faint.
.abele-short-list__row .abele-tree-item__text {
  // Never wider than what is left beside the glyph, so a long name wraps by it, not under it.
  max-width: calc(100% - var(--icon-xs) - var(--size-4-1));
  color: var(--text-normal);
}

.abele-short-list .abele-short-list__more {
  align-self: flex-start;
  margin-top: var(--size-2-2);
  // Asking for the rest is a quiet button under the rows, in the size of a row's facts.
  font-size: var(--abele-text-fact-size);
}
</style>
