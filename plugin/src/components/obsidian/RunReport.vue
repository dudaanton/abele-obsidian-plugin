<template>
  <div class="abele-run-report" :aria-busy="running">
    <!-- Finished, the job says how it went in one line: a mark, the words, and what came of it
         as quiet facts after them. While it runs, where it is, with a bar under it. -->
    <div v-if="finished" class="abele-run-report__outcome" role="status">
      <ResultMark :state="errors.length ? 'error' : 'done'" :text="status" />
      <span class="abele-run-report__headline">{{ status }}</span>
    </div>
    <div v-else-if="status" class="abele-run-report__status" role="status">{{ status }}</div>
    <Progress
      v-if="running"
      class="abele-run-report__progress"
      :value="percent"
      :label="status || t('kit.progress')"
    />
    <div v-if="facts.length" class="abele-run-report__facts">
      <template v-for="(fact, i) in facts" :key="fact.label">
        <span v-if="i" class="abele-run-report__separator" aria-hidden="true"> · </span>
        <span class="abele-run-report__fact"
          ><span class="abele-run-report__value">{{ fact.value }}</span>
          {{ fact.label.toLowerCase() }}</span
        >
      </template>
    </div>
    <ShortList
      v-if="errors.length"
      class="abele-run-report__errors"
      :heading="t('kit.errors')"
      tone="error"
      :items="errors.map((title) => ({ title }))"
    />
    <slot />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * What a long job a window started is doing and what came of it: a line of where it is with a bar
 * under it while it runs, then the counts as quiet facts, anything the window adds, and the
 * errors — the first few, the rest on asking. One report for every import and migration.
 */
import Progress from './Progress.vue'
import ShortList from './ShortList.vue'
import ResultMark from './ResultMark.vue'

withDefaults(
  defineProps<{
    running?: boolean
    /** Over: the status is how it ended, said with a mark — a tick, or a cross when there were errors. */
    finished?: boolean
    /** "Transactions · 340 of 1 200", "Import complete". */
    status?: string
    /** Done so far, out of 100; left out, the bar only says it is busy. */
    percent?: number
    facts?: Array<{ label: string; value: string | number }>
    errors?: string[]
  }>(),
  { status: '', percent: undefined, facts: () => [], errors: () => [] }
)
</script>

<style lang="scss">
.abele-run-report {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  min-width: 0;
}

.abele-run-report__status {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-run-report__progress {
  margin-top: calc(-1 * var(--size-4-2));
}

.abele-run-report__outcome {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-run-report__headline {
  color: var(--text-normal);
  font-weight: var(--font-medium);
}

.abele-run-report__facts {
  margin-top: calc(-1 * var(--size-4-2));
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

.abele-run-report__value {
  color: var(--text-normal);
  font-variant-numeric: tabular-nums;
}
</style>
