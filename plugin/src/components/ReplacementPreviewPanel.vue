<template>
  <div class="abele-replacement-preview">
    <Setting heading name="What to change" />
    <div class="abele-replacement-preview__replacements" :class="`${classPrefix}__replacements`">
      <ReplacementActionView
        v-for="action in replacements"
        :key="action.id"
        :action="action"
        @remove="emit('remove-replacement', action.id)"
      />
      <ObsidianButton
        quiet
        icon="plus"
        text="Add a change"
        tooltip="Another change to make in every note found"
        class="abele-replacement-preview__add-button"
        :class="`${classPrefix}__add-button`"
        @click="emit('add-replacement')"
      />
    </div>

    <!-- Where there is no window to stand at the foot of (a Bases view), the actions lead the
         results instead. -->
    <div
      v-if="inlineActions"
      class="abele-replacement-preview__buttons"
      :class="`${classPrefix}__buttons`"
    >
      <ObsidianButton
        :text="previewLabel"
        accent
        tooltip="Show what would change in each note"
        @click="emit('preview')"
      />
      <ObsidianButton
        :text="replaceLabel"
        :disabled="!results.length"
        tooltip="Make the changes in every note listed"
        @click="emit('replace')"
      />
      <ObsidianButton
        quiet
        text="Use in AI"
        tooltip="Hand these notes to a chat with the agent"
        :disabled="useInAiDisabled"
        @click="emit('send-to-agent')"
      />
    </div>

    <div
      v-if="results.length"
      class="abele-replacement-preview__head"
      :class="`${classPrefix}__count`"
    >
      {{ results.length }} {{ results.length === 1 ? 'note' : 'notes' }} would change
    </div>
    <div class="abele-replacement-preview__results" :class="`${classPrefix}__results`" role="list">
      <EntryRow
        v-for="result in visibleResults"
        :key="result.oldPath"
        role="listitem"
        class="abele-replacement-preview__result"
        :class="`${classPrefix}__result`"
        :more="!!open[result.oldPath]"
        more-label="the change"
        @update:more="open[result.oldPath] = $event"
      >
        <a
          class="abele-replacement-preview__note"
          :title="result.oldPath"
          @click="emit('go-to-note', result.oldPath)"
          >{{ noteName(result.oldPath) }}</a
        >
        <template #meta>
          <span v-if="folderOf(result.oldPath)">{{ folderOf(result.oldPath) }}</span>
          <span v-if="result.newPath !== result.oldPath">moves to {{ result.newPath }}</span>
        </template>
        <template v-if="result.oldRaw !== result.newRaw" #actions>
          <ObsidianIcon
            icon="replace"
            tooltip="Apply changes to this note"
            class="abele-replacement-preview__apply"
            @click="emit('replace-one', result)"
          />
          <ObsidianIcon
            icon="x"
            tooltip="Leave this note out"
            class="abele-replacement-preview__drop"
            @click="emit('remove-result', result)"
          />
        </template>
        <template #detail>
          <div v-if="result.error" class="abele-replacement-preview__error" role="alert">
            {{ result.error }}
          </div>
          <Diff
            v-if="open[result.oldPath]"
            :text-left="result.oldRaw"
            :text-right="result.newRaw"
          />
        </template>
      </EntryRow>
      <ObsidianButton
        v-if="canLoadMore"
        quiet
        text="Load more"
        tooltip="Show the next notes found"
        class="abele-replacement-preview__more"
        @click="loadMore"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useInfiniteScroll } from '@vueuse/core'
import type { ReplacementAction } from '@/entities/ReplacementAction'
import type { ReplacementPreview } from '@/helpers/bulkReplacement'
import ReplacementActionView from './ReplacementAction.vue'
import Diff from './Diff.vue'
import ObsidianButton from './obsidian/Button.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import EntryRow from './obsidian/EntryRow.vue'
import Setting from './obsidian/Setting.vue'

const props = withDefaults(
  defineProps<{
    classPrefix: string
    replacements: ReplacementAction[]
    results: ReplacementPreview[]
    previewLabel: string
    useInAiDisabled: boolean
    scrollContainer?: HTMLElement | null
    /** The actions above the results; a window puts them at its foot instead. */
    inlineActions?: boolean
  }>(),
  { inlineActions: true, scrollContainer: null }
)
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
const replaceLabel = computed(() =>
  props.results.length
    ? `Replace in ${props.results.length} ${props.results.length === 1 ? 'note' : 'notes'}`
    : 'Replace all'
)
// The changes stay folded: a list of whole notes side by side ran to several screens.
const open = reactive<Record<string, boolean>>({})
const noteName = (path: string) => path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
const folderOf = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf('/')))
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
  gap: var(--size-4-2);
}

.abele-replacement-preview .abele-replacement-preview__add-button {
  align-self: flex-start;
  margin-top: var(--size-2-2);
}

.abele-replacement-preview__buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-2);
  margin-top: var(--size-4-4);
}

// The results' own heading: a step above them, apart from the changes over it.
.abele-replacement-preview__head {
  margin-top: var(--size-4-6);
  margin-bottom: var(--size-2-2);
  padding-inline: var(--size-2-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);

  .modal-content & {
    padding-inline: 0;
  }
}

.abele-replacement-preview__results {
  display: flex;
  flex-direction: column;
}

.abele-replacement-preview__note {
  color: var(--text-normal);
  text-decoration: none;
  cursor: var(--cursor-link);

  &:hover {
    color: var(--text-accent);
  }
}

.abele-replacement-preview__error {
  color: var(--text-error);
  font-size: var(--font-ui-smaller);
}

.abele-replacement-preview .abele-replacement-preview__more {
  align-self: flex-start;
  margin-top: var(--size-4-2);
  padding-inline: var(--size-2-3);

  .modal-content & {
    padding-inline: 0;
  }
}
</style>
