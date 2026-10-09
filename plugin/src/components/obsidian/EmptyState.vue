<template>
  <div
    class="abele-empty-state"
    :role="variant === 'error' ? 'alert' : 'status'"
    :aria-busy="variant === 'loading'"
  >
    <slot>{{ text || labels[variant] }}</slot>
    <div v-if="$slots.action" class="abele-empty-state__action"><slot name="action" /></div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    text?: string
    variant?: 'empty' | 'no-matches' | 'loading' | 'error'
  }>(),
  { variant: 'empty' }
)
const labels = {
  empty: 'No items yet',
  'no-matches': 'No matches',
  loading: 'Loading…',
  error: 'Could not load items',
}
</script>

<style lang="scss">
.abele-empty-state {
  padding: var(--size-4-3) 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-empty-state__action {
  margin-top: var(--size-4-2);
}
</style>
