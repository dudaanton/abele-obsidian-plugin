<template>
  <div class="abele-empty-state">
    <slot>{{ text }}</slot>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  text?: string
}>()
</script>

<style lang="scss">
.abele-empty-state {
  padding: var(--size-4-3) 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
</style>
