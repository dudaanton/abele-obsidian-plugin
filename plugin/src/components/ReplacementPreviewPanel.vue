<template>
  <div class="abele-replacement-preview">
    <h4>Replacement</h4>
    <div class="abele-replacement-preview__replacements" :class="`${classPrefix}__replacements`">
      <ReplacementActionView
        v-for="action in replacements"
        :key="action.id"
        :action="action"
        @remove="emit('remove-replacement', action.id)"
      />
      <ObsidianIcon
        icon="plus"
        class="abele-replacement-preview__add-button"
        :class="`${classPrefix}__add-button`"
        text-right="Add replacement"
        @click="emit('add-replacement')"
      />
    </div>
    <h4>Results</h4>
    <div class="abele-replacement-preview__buttons" :class="`${classPrefix}__buttons`">
      <ObsidianButton :text="previewLabel" accent @click="emit('preview')" />
      <ObsidianButton text="Replace all" :disabled="!results.length" @click="emit('replace')" />
      <ObsidianButton text="Use in AI" :disabled="useInAiDisabled" @click="emit('send-to-agent')" />
      <div class="abele-replacement-preview__count" :class="`${classPrefix}__count`">
        {{ results.length }} results
      </div>
    </div>
    <div class="abele-replacement-preview__results" :class="`${classPrefix}__results`">
      <div
        v-for="result in visibleResults"
        :key="result.oldPath"
        class="abele-replacement-preview__result"
        :class="`${classPrefix}__result`"
      >
        <a @click="emit('go-to-note', result.oldPath)">{{ result.oldPath }}</a>
        <Diff :text-left="result.oldRaw" :text-right="result.newRaw" />
        <div v-if="result.error" role="alert">{{ result.error }}</div>
        <ObsidianIcon
          v-if="result.oldRaw !== result.newRaw"
          icon="replace"
          class="abele-replacement-preview__add-button"
          text-right="Apply changes to this note"
          @click="emit('replace-one', result)"
        />
        <ObsidianIcon
          v-if="result.oldRaw !== result.newRaw"
          icon="cross"
          class="abele-replacement-preview__add-button"
          text-right="Remove from results"
          @click="emit('remove-result', result)"
        />
      </div>
      <ObsidianButton v-if="canLoadMore" text="Load more" @click="loadMore" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useInfiniteScroll } from '@vueuse/core'
import type { ReplacementAction } from '@/entities/ReplacementAction'
import type { ReplacementPreview } from '@/helpers/bulkReplacement'
import ReplacementActionView from './ReplacementAction.vue'
import Diff from './Diff.vue'
import ObsidianButton from './obsidian/Button.vue'
import ObsidianIcon from './obsidian/Icon.vue'

const props = defineProps<{
  classPrefix: string
  replacements: ReplacementAction[]
  results: ReplacementPreview[]
  previewLabel: string
  useInAiDisabled: boolean
  scrollContainer?: HTMLElement | null
}>()
const emit = defineEmits<{
  'add-replacement': []
  'remove-replacement': [id: string]
  preview: []
  replace: []
  'send-to-agent': []
  'go-to-note': [path: string]
  'replace-one': [result: ReplacementPreview]
  'remove-result': [result: ReplacementPreview]
}>()
const batchSize = 10
const visibleCount = ref(batchSize)
const visibleResults = computed(() => props.results.slice(0, visibleCount.value))
const canLoadMore = computed(() => visibleCount.value < props.results.length)
const loadMore = () => {
  visibleCount.value += batchSize
}
// Only a fresh preview resets paging; applying/removing a row must not hide later rows.
watch(
  () => props.results,
  (results) => {
    if (!results.length) visibleCount.value = batchSize
  }
)
useInfiniteScroll(() => props.scrollContainer ?? null, loadMore, {
  distance: batchSize,
  canLoadMore: () => canLoadMore.value,
})
</script>

<style lang="scss">
.abele-replacement-preview__replacements {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 2);
  margin-bottom: calc(var(--p-spacing) * 1.5);
}
.abele-replacement-preview__add-button {
  width: fit-content;
  align-self: flex-start;
}
.abele-replacement-preview__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--p-spacing) / 4);
}
.abele-replacement-preview__count {
  margin-left: calc(var(--p-spacing) / 2);
  align-self: center;
  color: var(--text-muted);
}
.abele-replacement-preview__results {
  margin-top: var(--p-spacing);
  display: flex;
  flex-direction: column;
  gap: var(--p-spacing);
}
.abele-replacement-preview__result {
  display: flex;
  flex-direction: column;
  gap: calc(var(--p-spacing) / 2);
  padding: calc(var(--p-spacing) / 2);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  p {
    margin: 0;
  }
  .cm-gutters.cm-gutters-before {
    background-color: transparent;
  }
  .cm-mergeViewEditor:first-child .cm-gutters.cm-gutters-before {
    border: none;
  }
}
@media (max-width: 845px) {
  .abele-sar-fm-modal .abele-replacement-preview__replacements {
    gap: var(--p-spacing);
  }
}
</style>
