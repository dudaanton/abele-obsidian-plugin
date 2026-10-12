<template>
  <div class="abele-run-report" :aria-busy="running">
    <div v-if="status" class="abele-run-report__status" role="status">{{ status }}</div>
    <Progress
      v-if="running"
      class="abele-run-report__progress"
      :value="percent"
      :label="status || 'Progress'"
    />
    <!-- What came of it, a fact a row: what, then how many, as Obsidian's file properties. -->
    <dl v-if="facts.length" class="abele-run-report__facts">
      <div v-for="fact in facts" :key="fact.label" class="abele-run-report__fact">
        <dt>{{ fact.label }}</dt>
        <dd>{{ fact.value }}</dd>
      </div>
    </dl>
    <slot />
    <ShortList
      v-if="errors.length"
      class="abele-run-report__errors"
      heading="Errors"
      tone="error"
      :items="errors.map((title) => ({ title }))"
    />
  </div>
</template>

<script setup lang="ts">
/**
 * What a long job a window started is doing and what came of it: a line of where it is with a bar
 * under it while it runs, then the counts as quiet facts, anything the window adds, and the
 * errors — the first few, the rest on asking. One report for every import and migration.
 */
import Progress from './Progress.vue'
import ShortList from './ShortList.vue'

withDefaults(
  defineProps<{
    running?: boolean
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

.abele-run-report__facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: var(--size-2-2) var(--size-4-4);
  margin: 0;
  font-size: var(--font-ui-small);
}

.abele-run-report__fact {
  display: contents;

  dt {
    color: var(--text-muted);
  }

  dd {
    margin: 0;
    color: var(--text-normal);
    font-variant-numeric: tabular-nums;
  }
}
</style>
