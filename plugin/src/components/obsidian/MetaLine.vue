<template>
  <div v-if="present.length" class="abele-meta-line">
    <template v-for="(fact, index) in present" :key="fact.key">
      <template v-if="index"> · </template>
      <span class="abele-meta-line__fact"
        ><template v-if="fact.label">{{ fact.label }}: </template>{{ fact.value }}</span
      >
    </template>
    <slot />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
export interface MetaFact {
  key: string
  label?: string
  value?: string | number | null
  required?: boolean
  unknown?: string
}
const props = defineProps<{ facts: MetaFact[] }>()
const present = computed(() =>
  props.facts.flatMap((fact) => {
    const missing = fact.value === undefined || fact.value === null || fact.value === ''
    return missing && !fact.required
      ? []
      : [{ ...fact, value: missing ? (fact.unknown ?? 'Unknown') : fact.value }]
  })
)
</script>
<style>
.abele-meta-line {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-normal);
  line-height: var(--line-height-normal);
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-meta-line__fact {
  display: inline;
}
</style>
