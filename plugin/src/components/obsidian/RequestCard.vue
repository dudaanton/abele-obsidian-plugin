<template>
  <div class="abele-request-card" :class="{ 'abele-request-card_waiting': waiting }">
    <slot />
  </div>
</template>

<script setup lang="ts">
/** A request or recovery card, on the host's geometry. Its content owns the named actions. */
defineProps<{ waiting?: boolean }>()
</script>

<style lang="scss">
.abele-request-card {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  font-size: var(--font-ui-small);
  color: var(--text-normal);
  min-width: 0;
  overflow-wrap: anywhere;
}
.abele-request-card_waiting {
  border-color: var(--interactive-accent);
}
</style>
