<template>
  <div class="abele-found-list" :aria-busy="state === 'working'">
    <!-- Looking: the whole list's place says so, with how far it has got. -->
    <EmptyState
      v-if="state === 'working'"
      variant="loading"
      :icon="icon"
      :title="workingTitle"
      :text="workingText"
    >
      <template v-if="progress" #action>
        <Progress
          :value="progress.total ? progress.done : undefined"
          :max="progress.total || undefined"
          :label="workingTitle ?? 'Progress'"
          class="abele-found-list__progress"
        />
      </template>
    </EmptyState>
    <EmptyState
      v-else-if="state === 'error'"
      variant="error"
      :icon="icon"
      badge="circle-alert"
      :title="errorTitle"
      :text="errorText"
    />
    <EmptyState
      v-else-if="state === 'none'"
      :icon="icon"
      badge="check"
      :title="noneTitle"
      :text="noneText"
    />
    <template v-else>
      <!-- What was found, in one quiet line, and choosing all of it at its end. -->
      <div class="abele-found-list__head">
        <span class="abele-found-list__summary"
          ><slot name="summary">{{ summary }}</slot></span
        >
        <Button
          v-if="selectable && total"
          quiet
          class="abele-found-list__all"
          :text="chosen === total ? 'Clear' : 'Select all'"
          :tooltip="chosen === total ? 'Choose none of these' : 'Choose every one of these'"
          @click="emit(chosen === total ? 'clear' : 'select-all')"
        />
      </div>
      <div class="abele-found-list__rows" role="list"><slot /></div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * What a window found when it looked through the vault, and the place it fills while it looks:
 * the same four states for every such window — looking (with how far it has got), nothing found,
 * failed, and the list with a quiet line of what it adds up to. Rows are the caller's, usually
 * EntryRows with a check at their start; what to do with the chosen ones is the window's footer.
 */
import Button from './Button.vue'
import EmptyState from './EmptyState.vue'
import Progress from './Progress.vue'

withDefaults(
  defineProps<{
    state: 'working' | 'list' | 'none' | 'error'
    /** The subject's glyph for the large states: `image`, `copy`, `file-search`. */
    icon?: string
    workingTitle?: string
    workingText?: string
    /** How far the look has got; a total of 0 or none draws a bar that only says it is busy. */
    progress?: { done: number; total: number }
    noneTitle?: string
    noneText?: string
    errorTitle?: string
    errorText?: string
    /** "12 files · 48 MB" over the rows. */
    summary?: string
    /** Rows can be chosen: "Select all" or "Clear" at the end of the summary line. */
    selectable?: boolean
    chosen?: number
    total?: number
  }>(),
  {
    icon: undefined,
    workingTitle: undefined,
    workingText: undefined,
    progress: undefined,
    noneTitle: undefined,
    noneText: undefined,
    errorTitle: undefined,
    errorText: undefined,
    summary: undefined,
    chosen: 0,
    total: 0,
  }
)
const emit = defineEmits<{ 'select-all': []; clear: [] }>()
</script>

<style lang="scss">
.abele-found-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

// Its own width: the action row under an empty state is only as wide as what is in it.
.abele-found-list .abele-found-list__progress {
  width: 16em;
  max-width: 100%;
}

// The summary is the list's own heading: in line with the words of the rows under it, closer to
// them than to whatever stands above the list.
.abele-found-list__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--size-4-2);
  margin-top: var(--size-4-3);
  margin-bottom: var(--size-2-2);
  padding-inline: var(--size-2-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-found-list__summary {
  min-width: 0;
  font-variant-numeric: tabular-nums;
}

.abele-found-list__all {
  flex: none;
}

.abele-found-list__rows {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
